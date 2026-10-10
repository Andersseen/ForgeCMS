import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger, defineCollection, defineField, setLogger } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleCreate, handleList } from './handlers.js';
import { handleFile } from './files.js';
import { handleLogin } from './auth-handlers.js';

// Spec 089 — no secret or provider-internal detail may reach an HTTP response or anything Forge writes
// to its logger/console when a dependency fails. The markers stand for credentials a driver, SDK or
// host error can quote in its message or properties; the failure is injected deterministically.

const AUTH_SECRET = 'FORGE_R02_AUTH_SECRET_DO_NOT_LOG';
const S3_SECRET = 'FORGE_R02_S3_SECRET_DO_NOT_LOG';
const TOKEN = 'FORGE_R02_TOKEN_DO_NOT_LOG';
const MARKERS = [AUTH_SECRET, S3_SECRET, TOKEN];

/** A realistic provider error: the secret is in the message AND in provider metadata properties. */
function providerError(secret: string): Error {
  return Object.assign(new Error(`connect failed for key ${secret} at https://provider.test`), {
    code: 'ECONNRESET',
    $metadata: { requestId: 'r-1', credentials: secret },
    config: { authToken: secret }
  });
}

const media = defineCollection({
  slug: 'media',
  upload: true,
  access: { read: () => true, create: () => true, delete: () => true },
  fields: { filename: defineField.text(), url: defineField.text(), alt: defineField.text() }
});
const posts = defineCollection({
  slug: 'posts',
  access: { read: () => true, create: () => true },
  fields: { title: defineField.text({ required: true }) }
});

function capture() {
  const logged: unknown[][] = [];
  setLogger({
    error: (...a) => logged.push(a),
    warn: (...a) => logged.push(a),
    info: (...a) => logged.push(a),
    debug: (...a) => logged.push(a)
  });
  const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a))
  );
  const text = () =>
    logged
      .flat()
      .map((v) => {
        if (v instanceof Error)
          return `${v.name} ${v.message} ${v.stack ?? ''} ${JSON.stringify({ ...v })}`;
        return typeof v === 'string' ? v : JSON.stringify(v);
      })
      .join('\n');
  return { logged, text, restore: () => spies.forEach((s) => s.mockRestore()) };
}

async function build(
  overrides: {
    database?: InMemoryDatabaseAdapter;
    storage?: InMemoryStorageAdapter;
    auth?: InMemoryAuthAdapter;
  } = {}
) {
  const database = overrides.database ?? new InMemoryDatabaseAdapter();
  const storage = overrides.storage ?? new InMemoryStorageAdapter();
  const auth = overrides.auth ?? new InMemoryAuthAdapter();
  const runtime = new ForgeCmsRuntime({
    collections: [posts, media],
    adapters: { database, auth, storage }
  });
  runtime.init();
  await runtime.syncSchema();
  return { database, storage, auth, runtime };
}

afterEach(() => setLogger(consoleLogger));

describe('dependency failures never leak secrets (spec 089)', () => {
  it('a database failure during a read becomes a generic 500 with nothing quoted', async () => {
    const cap = capture();
    try {
      const { database, runtime } = await build();
      database.findMany = async () => {
        throw providerError(AUTH_SECRET);
      };
      const response = await handleList(
        {
          request: new Request('http://x/api/v1/posts'),
          params: { collection: 'posts' },
          env: undefined
        },
        { runtime }
      );
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(JSON.parse(body)).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
      });
      for (const marker of MARKERS) {
        expect(body).not.toContain(marker);
        expect(cap.text()).not.toContain(marker);
      }
      // Still diagnosable: the log says what failed, by class, without the provider's message.
      expect(cap.logged.length).toBeGreaterThan(0);
    } finally {
      cap.restore();
    }
  });

  it('an auth adapter outage is a 500 whose log carries no credential', async () => {
    const cap = capture();
    try {
      const auth = new InMemoryAuthAdapter();
      auth.requireAuth = async () => {
        throw providerError(TOKEN);
      };
      const { runtime } = await build({ auth });
      const response = await handleCreate(
        {
          request: new Request('http://x/api/v1/posts', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify({ title: 'x' })
          }),
          params: { collection: 'posts' },
          env: undefined
        },
        { runtime, requireAuth: true }
      );
      expect(response.status).toBe(500);
      const body = await response.text();
      for (const marker of MARKERS) {
        expect(body).not.toContain(marker);
        expect(cap.text()).not.toContain(marker);
      }
    } finally {
      cap.restore();
    }
  });

  it('a login backed by a failing adapter responds generically and logs no credential', async () => {
    const cap = capture();
    try {
      const { runtime } = await build();
      const login = vi.fn(async () => {
        throw providerError(AUTH_SECRET);
      });
      (runtime.adapters.auth as unknown as { login: unknown }).login = login;
      const response = await handleLogin(
        {
          request: new Request('http://x/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.test', password: TOKEN })
          }),
          env: undefined
        },
        { runtime }
      );
      expect(response.status).toBe(500);
      const body = await response.text();
      for (const marker of MARKERS) {
        expect(body).not.toContain(marker);
        expect(cap.text()).not.toContain(marker);
      }
    } finally {
      cap.restore();
    }
  });

  it('a storage put failure during upload is a generic 500, leaves no document, and logs no secret', async () => {
    const cap = capture();
    try {
      const { storage, database, runtime } = await build();
      storage.put = async () => {
        throw providerError(S3_SECRET);
      };
      const body = new FormData();
      body.set('file', new File(['bytes'], 'a.txt', { type: 'text/plain' }));
      const response = await handleCreate(
        {
          request: new Request('http://x/api/v1/media', { method: 'POST', body }),
          params: { collection: 'media' },
          env: undefined
        },
        { runtime }
      );
      expect(response.status).toBe(500);
      const text = await response.text();
      for (const marker of MARKERS) {
        expect(text).not.toContain(marker);
        expect(cap.text()).not.toContain(marker);
      }
      expect(await database.findMany({ collection: 'media' })).toEqual([]);
    } finally {
      cap.restore();
    }
  });

  it('a failed compensating storage delete logs the object key but not the provider message', async () => {
    const cap = capture();
    try {
      const { storage, runtime } = await build();
      storage.delete = async () => {
        throw providerError(S3_SECRET);
      };
      const body = new FormData();
      body.set('file', new File(['bytes'], 'a.txt', { type: 'text/plain' }));
      body.set('alt', 'a');
      // Force the document commit to fail so the stored object needs compensating deletion.
      runtime.adapters.database.atomicWrite = async () => {
        throw providerError(AUTH_SECRET);
      };
      const response = await handleCreate(
        {
          request: new Request('http://x/api/v1/media', { method: 'POST', body }),
          params: { collection: 'media' },
          env: undefined
        },
        { runtime }
      );
      expect(response.status).toBe(500);
      const logs = cap.text();
      for (const marker of MARKERS) expect(logs).not.toContain(marker);
      expect(logs).toMatch(/Failed to delete storage object 'media\//);
    } finally {
      cap.restore();
    }
  });

  it('a provider outage while reading a stored file is a generic 500', async () => {
    const cap = capture();
    try {
      const { storage, runtime } = await build();
      const body = new FormData();
      body.set('file', new File(['bytes'], 'a.txt', { type: 'text/plain' }));
      const created = await handleCreate(
        {
          request: new Request('http://x/api/v1/media', { method: 'POST', body }),
          params: { collection: 'media' },
          env: undefined
        },
        { runtime }
      );
      expect(created.status).toBe(201);
      const [stored] = await storage.list();
      storage.get = async () => {
        throw providerError(S3_SECRET);
      };
      const response = await handleFile(
        {
          request: new Request('http://x/api/media/x'),
          params: { key: stored!.key },
          env: undefined
        },
        { runtime }
      );
      expect(response.status).toBe(500);
      const text = await response.text();
      for (const marker of MARKERS) {
        expect(text).not.toContain(marker);
        expect(cap.text()).not.toContain(marker);
      }
    } finally {
      cap.restore();
    }
  });
});
