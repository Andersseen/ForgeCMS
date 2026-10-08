// Spec 083 (roadmap 0.10 / P02): the portable upload lifecycle from PACKED public packages, across two
// separate Node processes. Runs as the `consumer` stage of `pnpm test:s3` (scripts/test-s3.mjs), which
// supplies the real Garage service as FORGE_S3_TEST_*; it never skips without them.
//
// A clean temporary project installs only `pnpm pack` tarballs (no workspace source, no deep imports),
// compiles a strict-TypeScript consumer, and runs
//
//   process A: create schema + first admin → multipart upload through `handleCreate` → verify the S3
//              object, the libSQL document and the access-checked `handleFile` reads → exit
//   process B: a NEW process opens the SAME libSQL file and bucket → serves the persisted bytes →
//              deletes through `handleDelete` → verifies the object and every storage intent are gone
//
// There is no browser bundle in this consumer: S3 configuration is server-side only by construction.
// FORGE_CMS_KEEP_SSR_TMP=1 keeps the temporary project.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NPMRC, keep, pack } from './ssr-consumer/shared.mjs';

const PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/s3',
  '@forge-cms/api',
  '@forge-cms/runtime'
];

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run this through \`pnpm test:s3\`.`);
  return value;
};
const secretAccessKey = required('FORGE_S3_TEST_SECRET_ACCESS_KEY');
const s3Env = {
  S3_BUCKET: required('FORGE_S3_TEST_BUCKET'),
  S3_REGION: required('FORGE_S3_TEST_REGION'),
  S3_ENDPOINT: required('FORGE_S3_TEST_ENDPOINT'),
  S3_ACCESS_KEY_ID: required('FORGE_S3_TEST_ACCESS_KEY_ID'),
  S3_SECRET_ACCESS_KEY: secretAccessKey,
  S3_FORCE_PATH_STYLE: 'true'
};

const SHARED = `import { defineCollection, defineField } from '@forge-cms/core';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { S3StorageAdapter } from '@forge-cms/s3';
import { ForgeCmsRuntime } from '@forge-cms/runtime';

const users = defineUsersCollection();
const isStaff = (user: { role?: string } | null) => user?.role === 'admin' || user?.role === 'editor';
const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text({ required: true }),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text(),
    visibility: defineField.select({ options: ['public', 'private'], defaultValue: 'public' })
  },
  access: {
    read: ({ user }) => (isStaff(user) ? true : { visibility: { eq: 'public' } }),
    create: ({ user }) => isStaff(user),
    update: ({ user }) => isStaff(user),
    delete: ({ user }) => user?.role === 'admin'
  }
});

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is not set');
  return value;
}

export function makeStorage(): S3StorageAdapter {
  return new S3StorageAdapter({
    bucket: env('S3_BUCKET'),
    region: env('S3_REGION'),
    endpoint: env('S3_ENDPOINT'),
    forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
    credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') }
  });
}

/** What every process builds from nothing but the database file and the bucket. */
export async function start() {
  const database = new LibSqlDatabaseAdapter('file:' + env('FORGE_DB_FILE')).init();
  const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
  const storage = makeStorage();
  const runtime = new ForgeCmsRuntime({
    collections: [users, media],
    adapters: { database, auth, storage }
  });
  runtime.init();
  await runtime.syncSchema();
  return { database, auth, storage, runtime };
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message);
}

export const ORIGIN = 'https://forge.test';
`;

const PROCESS_A = `import { handleCreate, handleFile } from '@forge-cms/runtime';
import { writeFileSync } from 'node:fs';
import { ORIGIN, check, env, start } from './shared.js';

const { auth, database, storage, runtime } = await start();
const payload = Uint8Array.from([0, 1, 2, 254, 255, 10, 13, 42]);

const owner = await auth.createUser({ email: 'owner@consumer.test', password: 'password123' });
check(owner.ok && owner.user.role === 'admin', 'the first user becomes the admin');
const token = owner.ok ? owner.token : '';

async function upload(name: string, type: string, body: BlobPart, visibility: string) {
  const form = new FormData();
  form.set('file', new File([body], name, { type }));
  form.set('visibility', visibility);
  const response = await handleCreate(
    {
      request: new Request(ORIGIN + '/api/v1/media', {
        method: 'POST',
        body: form,
        headers: { authorization: 'Bearer ' + token }
      }),
      params: { collection: 'media' },
      env: undefined
    },
    { runtime }
  );
  check(response.status === 201, 'multipart upload answered ' + response.status);
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

const publicDoc = await upload('logo.bin', 'application/octet-stream', payload, 'public');
const privateDoc = await upload('private note.txt', 'text/plain', 'staff only', 'private');

const publicKey = (await database.findById('media', String(publicDoc['id'])))?._storageKey;
check(typeof publicKey === 'string' && publicKey.startsWith('media/'), 'Forge records the storage key');
check(publicDoc['url'] === '/api/media/' + publicKey, 'the default public URL is the handleFile route');

const stored = await storage.get(String(publicKey));
check(stored?.contentType === 'application/octet-stream', 'S3 holds the content type');
check(
  stored?.body !== undefined && Buffer.from(stored.body).equals(Buffer.from(payload)),
  'S3 holds the exact bytes'
);
check((await database.findMany({ collection: '_forge_storage_intents' })).length === 0, 'no storage intent remains');

async function serve(url: string, bearer?: string) {
  return handleFile(
    {
      request: new Request(ORIGIN + url, bearer ? { headers: { authorization: 'Bearer ' + bearer } } : {}),
      params: { key: url.replace('/api/media/', '') },
      env: undefined
    },
    { runtime }
  );
}
const anonymous = await serve(String(publicDoc['url']));
check(anonymous.status === 200, 'a public file is served anonymously');
check(anonymous.headers.get('cache-control') === 'public, max-age=60', 'anonymous responses are cacheable');
check(Buffer.from(await anonymous.arrayBuffer()).equals(Buffer.from(payload)), 'served bytes are exact');
check((await serve(String(privateDoc['url']))).status === 404, 'a protected file is 404 anonymously');
const staff = await serve(String(privateDoc['url']), token);
check(staff.status === 200 && (await staff.text()) === 'staff only', 'staff read the protected file');
check(staff.headers.get('cache-control') === 'private, no-store', 'authenticated responses are never shared-cacheable');

writeFileSync(
  env('FORGE_STATE_FILE'),
  JSON.stringify({ publicDoc: publicDoc['id'], privateDoc: privateDoc['id'], publicUrl: publicDoc['url'], privateUrl: privateDoc['url'], publicKey })
);
console.log('process A ok: uploaded 2 files, verified S3 + libSQL + handleFile, exiting');
`;

const PROCESS_B = `import { handleDelete, handleFile } from '@forge-cms/runtime';
import { readFileSync } from 'node:fs';
import { ORIGIN, check, env, start } from './shared.js';

const state = JSON.parse(readFileSync(env('FORGE_STATE_FILE'), 'utf8')) as {
  publicDoc: string;
  privateDoc: string;
  publicUrl: string;
  privateUrl: string;
  publicKey: string;
};
const { auth, database, storage, runtime } = await start();
const payload = Uint8Array.from([0, 1, 2, 254, 255, 10, 13, 42]);

// A different process: nothing but the database file and the bucket carried over.
const login = await auth.login('owner@consumer.test', 'password123');
check(login.ok, 'the persisted admin can sign in');
const token = login.ok ? login.token : '';

async function serve(url: string, bearer?: string) {
  return handleFile(
    {
      request: new Request(ORIGIN + url, bearer ? { headers: { authorization: 'Bearer ' + bearer } } : {}),
      params: { key: url.replace('/api/media/', '') },
      env: undefined
    },
    { runtime }
  );
}

const anonymous = await serve(state.publicUrl);
check(anonymous.status === 200, 'the persisted public file is served after a restart');
check(Buffer.from(await anonymous.arrayBuffer()).equals(Buffer.from(payload)), 'persisted bytes are exact');
check((await serve(state.privateUrl)).status === 404, 'the protected file stays protected after a restart');
const staff = await serve(state.privateUrl, token);
check(staff.status === 200 && (await staff.text()) === 'staff only', 'staff read the persisted protected file');

const report = await runtime.reconcileStorage();
check(report.deleted.length === 0 && report.failed.length === 0, 'reconciliation has nothing to remove');
check((await storage.get(state.publicKey)) !== null, 'reconciliation kept the owned object');

for (const id of [state.publicDoc, state.privateDoc]) {
  const response = await handleDelete(
    {
      request: new Request(ORIGIN + '/api/v1/media/' + id, {
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + token }
      }),
      params: { collection: 'media', id },
      env: undefined
    },
    { runtime }
  );
  check(response.status === 204, 'delete answered ' + response.status);
}
check((await database.findById('media', state.publicDoc)) === null, 'the document is gone');
check((await storage.get(state.publicKey)) === null, 'the S3 object is gone');
check((await database.findMany({ collection: '_forge_storage_intents' })).length === 0, 'no storage intent remains');
check((await serve(state.publicUrl, token)).status === 404, 'a deleted file is 404');
console.log('process B ok: served persisted bytes after restart, deleted document + object, no intents left');
`;

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    lib: ['ES2022', 'DOM'],
    types: ['node'],
    outDir: 'dist'
  },
  include: ['src/**/*.ts']
};

function run(command, args, cwd, env = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  // Output is captured so a failure can be reported without ever echoing the S3 secret.
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', ...env }
    });
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.replaceAll(
      secretAccessKey,
      '[redacted]'
    );
    throw new Error(`${command} ${args.join(' ')} failed:\n${output}`);
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'forge-portable-storage-'));
try {
  const tarballs = pack(join(workDir, 'packs'), PACKAGES);
  const dir = join(workDir, 'consumer');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'forge-portable-storage-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: tarballs,
        devDependencies: { typescript: '5.9.2', '@types/node': '22.15.3' },
        // Forge's internal dependencies (runtime → db …) must resolve to the tarballs too.
        pnpm: { overrides: tarballs }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(dir, '.npmrc'), NPMRC);
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  writeFileSync(join(dir, 'src', 'shared.ts'), SHARED);
  writeFileSync(join(dir, 'src', 'process-a.ts'), PROCESS_A);
  writeFileSync(join(dir, 'src', 'process-b.ts'), PROCESS_B);

  // Public entry points only: every Forge import is a bare package name, never a deep or workspace path.
  for (const file of readdirSync(join(dir, 'src'))) {
    const source = readFileSync(join(dir, 'src', file), 'utf8');
    for (const match of source.matchAll(/from '(@forge-cms\/[^']+)'/g)) {
      if (!PACKAGES.includes(match[1]))
        throw new Error(`${file} imports ${match[1]}, not a package entry point`);
    }
    if (/packages\/|\/src\//.test(source.replace(/'\.\/[^']*'/g, ''))) {
      throw new Error(`${file} reaches into repository source`);
    }
  }

  run('pnpm', ['install'], dir);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], dir);

  const processEnv = {
    ...s3Env,
    FORGE_DB_FILE: join(workDir, 'forge.db'),
    FORGE_STATE_FILE: join(workDir, 'state.json')
  };
  for (const name of ['process-a', 'process-b']) {
    const output = run('node', [`dist/${name}.js`], dir, processEnv);
    process.stdout.write(output);
    if (output.includes(secretAccessKey)) throw new Error(`${name} printed the S3 secret`);
  }
  console.log('\nPacked portable-storage consumer passed (libSQL file + S3, two processes).');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
