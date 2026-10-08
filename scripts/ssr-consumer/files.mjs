// The minimal durable-file production journey (spec 084, roadmap 0.10 / P03), shared by both packed profiles.
//
// No new UI: the signed-in admin page of the production-built app uploads one file through the real multipart
// Forge handler (`POST /api/v1/media` → `handleCreate`), and a browser then loads it from `/api/media/…`
// (`handleFile`). Physical evidence is read straight from the durable stores —
//   node:       libSQL file + the real Garage bucket (GetObject through the AWS SDK)
//   cloudflare: the local D1 SQLite file + the local R2 object index Miniflare persists under `--persist-to`
// (LOCAL workerd + local D1 + local R2 — not a remote Cloudflare deployment.)

import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fail, repoRoot } from './shared.mjs';

// libSQL comes from a first-party app that already pins them (the packed consumers have none).
const { createClient } = createRequire(join(repoRoot, 'apps', 'tiny-project', 'package.json'))(
  '@libsql/client'
);

/** A real 1×1 PNG, so a browser can render exactly what was stored. */
export const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);
export const PRIVATE_TEXT = 'staff-only note — not for anonymous readers ✓';

function sqliteFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => join(dir, file));
}

async function rows(path, query) {
  const client = createClient({ url: `file:${path}` });
  try {
    return (await client.execute(query)).rows.map((row) => ({ ...row }));
  } finally {
    client.close();
  }
}

/** The durable stores of one production profile, for physical (not just HTTP) assertions. */
export function inspector(profile, { storage, s3 }) {
  if (profile.id === 'node') {
    const dbPath = join(storage, 'forge.db');
    const sdk = createRequire(join(repoRoot, 'packages', 's3', 'package.json'))(
      '@aws-sdk/client-s3'
    );
    const client = new sdk.S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
    });
    return {
      label: `libSQL file + Garage bucket ${s3.bucket}`,
      mediaRows: () => rows(dbPath, 'SELECT id, _storageKey AS key FROM media'),
      intents: async () => (await rows(dbPath, 'SELECT * FROM _forge_storage_intents')).length,
      async objectBytes(key) {
        try {
          const response = await client.send(
            new sdk.GetObjectCommand({ Bucket: s3.bucket, Key: key })
          );
          return new Uint8Array(await response.Body.transformToByteArray());
        } catch (err) {
          if (err?.name === 'NoSuchKey') return null;
          throw err;
        }
      },
      close: () => client.destroy()
    };
  }
  // Cloudflare: Miniflare persists D1 and R2 as SQLite files (+ blobs) under the --persist-to directory.
  const d1 = () => {
    const file = sqliteFiles(join(storage, 'v3', 'd1')).find((f) => !f.endsWith('metadata.sqlite'));
    if (!file) fail('cloudflare: no local D1 database was persisted');
    return file;
  };
  const r2Index = () => {
    const file = sqliteFiles(join(storage, 'v3', 'r2')).find((f) => !f.endsWith('metadata.sqlite'));
    if (!file) fail('cloudflare: no local R2 object index was persisted');
    return file;
  };
  return {
    label: 'local D1 + local R2 (Miniflare persistence)',
    mediaRows: () => rows(d1(), 'SELECT id, _storageKey AS key FROM media'),
    intents: async () => (await rows(d1(), 'SELECT * FROM _forge_storage_intents')).length,
    async objectBytes(key) {
      const index = r2Index();
      const found = await rows(
        index,
        `SELECT blob_id, size FROM _mf_objects WHERE key = '${key.replaceAll("'", "''")}'`
      );
      if (found.length === 0) return null;
      // The bytes live as a blob file next to the index; its size is part of the object index.
      const blobId = String(found[0].blob_id);
      const blobs = join(index, '..', '..', '..', 'r2');
      const match = readdirSync(blobs, { recursive: true })
        .map(String)
        .find((entry) => entry.endsWith(blobId));
      if (!match) fail(`cloudflare: R2 blob ${blobId} is missing on disk`);
      const { readFileSync } = await import('node:fs');
      return new Uint8Array(readFileSync(join(blobs, match)));
    },
    close() {}
  };
}

const same = (a, b) => a !== null && Buffer.from(a).equals(Buffer.from(b));

/** Runs in the admin page: a same-origin multipart upload, exactly what any HTTP client would send. */
async function upload(adminPage, { name, type, bytes, visibility }) {
  const result = await adminPage.evaluate(
    async ({ name, type, bytes, visibility }) => {
      const form = new FormData();
      form.set('file', new File([new Uint8Array(bytes)], name, { type }));
      form.set('visibility', visibility);
      const response = await fetch('/api/v1/media', {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      });
      return { status: response.status, body: await response.text() };
    },
    { name, type, bytes: [...bytes], visibility }
  );
  if (result.status !== 201) fail(`multipart upload answered ${result.status}: ${result.body}`);
  return JSON.parse(result.body).data;
}

/** An anonymous browser (no cookie) requests `path`. */
async function anonymousGet(browser, origin, path) {
  const context = await browser.newContext();
  try {
    const response = await context.request.get(`${origin}${path}`);
    return {
      status: response.status(),
      type: response.headers()['content-type'] ?? '',
      cache: response.headers()['cache-control'] ?? '',
      bytes: new Uint8Array(await response.body())
    };
  } finally {
    await context.close();
  }
}

/**
 * `ctx`: { profile, browser, adminPage, origin(): string, restart(): Promise<void>, state, s3 }.
 * `adminPage` is the signed-in admin of the production build.
 */
export async function durableFileJourney(ctx) {
  const { profile, browser, adminPage } = ctx;
  const stores = inspector(profile, { storage: ctx.state.storage, s3: ctx.s3 });
  try {
    // --- 1. upload one public image and one protected note through the real multipart handler ------------
    const publicDoc = await upload(adminPage, {
      name: 'journey pixel.png',
      type: 'image/png',
      bytes: PNG,
      visibility: 'public'
    });
    const privateDoc = await upload(adminPage, {
      name: 'staff note.txt',
      type: 'text/plain',
      bytes: new TextEncoder().encode(PRIVATE_TEXT),
      visibility: 'private'
    });
    const media = await stores.mediaRows();
    const keyOf = (id) => String(media.find((row) => row.id === id)?.key ?? '');
    const publicKey = keyOf(publicDoc.id);
    const privateKey = keyOf(privateDoc.id);
    if (!publicKey.startsWith('media/') || !privateKey.startsWith('media/')) {
      fail(`_storageKey values are not media/… keys: ${JSON.stringify(media)}`);
    }
    const routeFor = (key) => `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`;
    if (publicDoc.url !== routeFor(publicKey)) {
      fail(`the public URL is not the access-checked route: ${publicDoc.url}`);
    }
    if (!same(await stores.objectBytes(publicKey), PNG)) {
      fail(`${stores.label}: the stored object differs from the uploaded bytes`);
    }
    if ((await stores.intents()) !== 0) fail('a storage intent remained after a clean upload');
    console.log(
      `  ✓ multipart upload through handleCreate: 2 documents, _storageKey recorded, exact bytes in ${stores.label}`
    );

    // --- 2. a browser loads the file through handleFile; protected and unowned keys are not served ---------
    const serve = async (label) => {
      const anonymous = await anonymousGet(browser, ctx.origin(), publicDoc.url);
      if (anonymous.status !== 200 || !anonymous.type.startsWith('image/png')) {
        fail(`${label}: anonymous GET ${publicDoc.url} → ${anonymous.status} ${anonymous.type}`);
      }
      if (!same(anonymous.bytes, PNG)) fail(`${label}: served bytes differ from the upload`);
      if (!anonymous.cache.startsWith('public')) fail(`${label}: cache-control ${anonymous.cache}`);
      const hidden = await anonymousGet(browser, ctx.origin(), privateDoc.url);
      if (hidden.status !== 404) fail(`${label}: protected file answered ${hidden.status}`);
      for (const path of [
        '/api/media/media/never-uploaded.png',
        `${publicDoc.url}.other`,
        '/api/media/..%2F..%2Fforge.db'
      ]) {
        const missing = await anonymousGet(browser, ctx.origin(), path);
        if (missing.status !== 404) fail(`${label}: unowned ${path} answered ${missing.status}`);
      }
      const staff = await adminPage.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'same-origin' });
        return {
          status: response.status,
          text: await response.text(),
          cache: response.headers.get('cache-control')
        };
      }, privateDoc.url);
      if (
        staff.status !== 200 ||
        staff.text !== PRIVATE_TEXT ||
        staff.cache !== 'private, no-store'
      ) {
        fail(`${label}: staff read of the protected file → ${staff.status} ${staff.cache}`);
      }
    };
    await serve('before restart');
    // The browser itself renders the image (not just an HTTP client).
    const rendered = await browser.newPage();
    await rendered.goto(`${ctx.origin()}${publicDoc.url}`);
    const naturalWidth = await rendered.evaluate(() => document.querySelector('img')?.naturalWidth);
    await rendered.close();
    if (naturalWidth !== 1) fail(`the browser did not render the stored PNG (${naturalWidth})`);
    console.log(
      '  ✓ browser: exact bytes + content type; protected file 404 anonymously / 200 for staff; unowned keys 404'
    );

    // --- 3. restart the production server: the file survives ---------------------------------------------
    await ctx.restart();
    await serve('after restart');
    if (!same(await stores.objectBytes(publicKey), PNG))
      fail('the object did not survive a restart');
    console.log(
      `  ✓ after a server restart the same URL still serves the exact bytes (${stores.label})`
    );

    // --- 4. the canonical delete removes document and physical object ------------------------------------
    for (const doc of [publicDoc, privateDoc]) {
      const status = await ctx.adminPage.evaluate(async (id) => {
        const response = await fetch(`/api/v1/media/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        return response.status;
      }, doc.id);
      if (status !== 204) fail(`DELETE /api/v1/media/${doc.id} answered ${status}`);
    }
    const gone = await anonymousGet(browser, ctx.origin(), publicDoc.url);
    if (gone.status !== 404) fail(`a deleted file answered ${gone.status}`);
    for (const key of [publicKey, privateKey]) {
      if ((await stores.objectBytes(key)) !== null) fail(`${key} still exists after delete`);
    }
    if ((await stores.mediaRows()).length !== 0) fail('media documents remain after delete');
    if ((await stores.intents()) !== 0) fail('a storage intent remains after delete');
    console.log(
      '  ✓ delete through the canonical path: documents, objects and storage intents are gone'
    );
  } finally {
    stores.close();
  }
}
