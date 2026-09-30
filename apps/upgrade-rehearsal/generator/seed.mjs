// Seeds the representative CMS model through a HISTORICAL ForgeCMS release's public API and dumps the
// persisted result. Runs inside a throwaway directory where `@forge-cms/*` resolve to that release.
//
//   FORGE_VERSION=0.4.0 PROFILE=libsql|d1-r2 OUT=<dir> node seed.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = process.env.FORGE_VERSION;
const PROFILE = process.env.PROFILE;
const OUT = process.env.OUT;
if (!VERSION || !PROFILE || !OUT) throw new Error('FORGE_VERSION, PROFILE and OUT are required');

const [major, minor] = VERSION.split('.').map(Number);
const atLeast = (m, n) => major > m || (major === m && minor >= n);
/** First release whose SQL adapters could persist a localized value (spec 066; probed). */
const SUPPORTS_LOCALIZED = atLeast(0, 6);

// --- Determinism (this process only) -------------------------------------------------------------
// Stable ids: a queue of planned ids, then a counter. Stable clock and "random" bytes, so a
// regeneration of the same version produces byte-identical fixtures.
const plannedIds = [];
let uuidCounter = 0;
const planIds = (...ids) => plannedIds.push(...ids);
const expectId = (actual, expected) => {
  if (actual !== expected) throw new Error(`expected id ${expected}, got ${actual}`);
  if (plannedIds.length > 0) throw new Error(`unused planned ids: ${plannedIds.join(', ')}`);
};
crypto.randomUUID = () =>
  plannedIds.shift() ?? `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;
let prng = 0x2545f491;
crypto.getRandomValues = (array) => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    prng ^= prng << 13;
    prng ^= prng >>> 17;
    prng ^= prng << 5;
    bytes[i] = prng & 0xff;
  }
  return array;
};
// A step clock: time only moves when the seed calls tick(), so timestamps do not depend on how many
// times library internals (or Miniflare's Node side) read the clock.
const RealDate = Date;
let clock = RealDate.parse('2026-01-15T09:00:00.000Z');
const tick = () => {
  clock += 60_000;
};
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(clock);
    else super(...args);
  }
  static now() {
    return clock;
  }
};

// --- Historical packages -------------------------------------------------------------------------
const core = await import('@forge-cms/core');
const db = await import('@forge-cms/db');
const auth = await import('@forge-cms/auth');
const storagePkg = await import('@forge-cms/storage');
const runtimePkg = await import('@forge-cms/runtime');
const { defineCollection, defineField, defineGlobal } = core;

// --- Test-only credentials (never real) ----------------------------------------------------------
const CREDENTIALS = {
  admin: { email: 'admin@fixture.test', password: 'fixture-admin-password' },
  editor: { email: 'editor@fixture.test', password: 'fixture-editor-password' },
  authSecret: 'fixture-only-auth-secret-0123456789abcdef'
};

// --- The representative model, as the application declared it at this release -----------------
const users = auth.defineUsersCollection();
const categories = defineCollection({
  slug: 'categories',
  fields: {
    label: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'label', index: true })
  }
});
const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text(),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number()
  }
});
const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  versions: true,
  ...(SUPPORTS_LOCALIZED && { locales: ['en', 'es'] }),
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title', unique: true }),
    ...(SUPPORTS_LOCALIZED && {
      summary: defineField.text({ localized: true })
    }),
    body: defineField.richtext(),
    seo: defineField.group({ fields: { description: defineField.text() } }),
    meta: defineField.json(),
    category: defineField.relation({
      collection: 'categories',
      onDelete: 'restrict'
    }),
    tags: defineField.relation({ collection: 'categories', many: true }),
    author: defineField.relation({ collection: 'users' }),
    hero: defineField.upload({ collection: 'media' })
  }
});
const settings = defineGlobal({
  slug: 'settings',
  fields: { siteName: defineField.text(), tagline: defineField.text() }
});

// --- Adapters for the profile --------------------------------------------------------------------
let database;
let storage;
let env = {};
let miniflare;
let d1;
const workDir = join(OUT, '.work');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
if (PROFILE === 'libsql') {
  database = new db.LibSqlDatabaseAdapter(`file:${join(workDir, 'fixture.db')}`);
  storage = new storagePkg.InMemoryStorageAdapter();
} else if (PROFILE === 'd1-r2') {
  const { Miniflare } = await import('miniflare');
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 204 }); } }',
    d1Databases: { DB: 'fixture-db' },
    r2Buckets: { BUCKET: 'fixture-bucket' },
    d1Persist: join(workDir, 'd1'),
    r2Persist: join(workDir, 'r2')
  });
  d1 = await miniflare.getD1Database('DB');
  env = { DB: d1, BUCKET: await miniflare.getR2Bucket('BUCKET') };
  const cf = await import('@forge-cms/cloudflare');
  database = new cf.D1DatabaseAdapter();
  storage = new cf.R2StorageAdapter();
} else {
  throw new Error(`Unknown PROFILE ${PROFILE}`);
}

const usersAuth = new auth.UsersCollectionAuthAdapter();
const apiKeyAuth = new auth.ApiKeyAuthAdapter();
const composite = new auth.CompositeAuthAdapter([usersAuth, apiKeyAuth]);
const runtime = new runtimePkg.ForgeCmsRuntime({
  env,
  collections: [users, categories, media, posts],
  globals: [settings],
  adapters: { database, auth: composite, storage }
});
database.init(env);
storage.init(env);
usersAuth.init({ AUTH_SECRET: CREDENTIALS.authSecret, userDatabase: database });
apiKeyAuth.init({ apiKeyDatabase: database });
await runtime.syncSchema();

const log = [];
async function createAs(id, args) {
  tick();
  planIds(id);
  const doc = await runtime.create(args);
  expectId(doc.id, id);
  return doc;
}
async function createKeyAs(id, input) {
  tick();
  planIds(id);
  const result = await apiKeyAuth.createApiKey(input);
  expectId(result.apiKey.id, id);
  return result;
}
const step = (msg) => log.push(msg);

// --- Users: first user becomes the admin, then an editor -----------------------------------------
// From 0.5.0 (spec 058; one batch since spec 060) the first admin is guarded by a `_forge_bootstrap`
// claim row, which is created before the user.
tick();
planIds(...(atLeast(0, 5) ? ['bootstrap_users'] : []), 'user_admin');
const admin = await usersAuth.createUser({
  ...CREDENTIALS.admin,
  name: 'Fixture Admin'
});
if (!admin.ok) throw new Error(`admin: ${admin.reason}`);
expectId(admin.user.id, 'user_admin');
tick();
planIds('user_editor');
const editor = await usersAuth.createUser({
  ...CREDENTIALS.editor,
  name: 'Fixture Editor',
  role: 'editor'
});
if (!editor.ok) throw new Error(`editor: ${editor.reason}`);
expectId(editor.user.id, 'user_editor');
step(`users: admin role=${admin.user.role}, editor role=${editor.user.role}`);

// --- API keys: one active, one revoked ---------------------------------------------------------
// Key ids stay UUID-shaped: an issued token is `<prefix>_<recordId>_<secret>` and the record id may
// not contain an underscore.
const KEY_ACTIVE = '00000000-0000-4000-8000-00000000a001';
const KEY_REVOKED = '00000000-0000-4000-8000-00000000a002';
const ciKey = await createKeyAs(KEY_ACTIVE, {
  name: 'CI deploy',
  scopes: ['content:read']
});
const revokedKey = await createKeyAs(KEY_REVOKED, {
  name: 'Old integration',
  scopes: ['content:write']
});
tick();
await apiKeyAuth.revokeApiKey(revokedKey.apiKey.id);

// --- Categories ----------------------------------------------------------------------------------
await createAs('category_news', { collection: 'categories', data: { label: 'News' } });
await createAs('category_guides', { collection: 'categories', data: { label: 'Guides' } });

// --- Media -----------------------------------------------------------------------------------------
// Uploads go through the release's own HTTP handler (multipart), exactly like a browser upload.
// From 0.6.0 (spec 067) an upload also records a durable storage intent before the object is written.
const HAS_UPLOAD_INTENTS = atLeast(0, 6);
async function upload(docId, keyUuid, name, type, bytes) {
  tick();
  const form = new FormData();
  form.set('file', new File([bytes], name, { type }));
  planIds(keyUuid, ...(HAS_UPLOAD_INTENTS ? [`intent_${docId}`] : []), docId);
  const response = await runtimePkg.handleCreate(
    {
      request: new Request('http://fixture.test/api/v1/media', {
        method: 'POST',
        headers: { authorization: `Bearer ${admin.token}` },
        body: form
      }),
      params: { collection: 'media' },
      env
    },
    { runtime }
  );
  if (response.status !== 201)
    throw new Error(`upload: ${response.status} ${await response.text()}`);
  const doc = (await response.json()).data;
  expectId(doc.id, docId);
  step(`upload: ${doc.id} ${doc._storageKey}`);
  return doc;
}
// A 1x1 transparent PNG.
const HERO_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
);
await upload(
  'media_hero',
  '00000000-0000-4000-8000-00000000f11e',
  'hero.png',
  'image/png',
  HERO_PNG
);

const BROCHURE = new TextEncoder().encode('%PDF-1.4\n% ForgeCMS upgrade fixture brochure\n%%EOF\n');
if (atLeast(0, 6)) {
  // Spec 063 (0.6.0) made `_storageKey` Forge-owned: a file can only enter through the upload path.
  await upload(
    'media_brochure',
    '00000000-0000-4000-8000-00000000b20c',
    'brochure.pdf',
    'application/pdf',
    BROCHURE
  );
} else {
  // Before 0.6.0 an application could write the object itself through the public StorageAdapter API
  // (here with custom metadata, which Forge's own upload path never sets) and register the document
  // with an explicit `_storageKey`. Kept because real 0.4.x installations may contain such rows.
  const brochureKey = 'media/manual/brochure.pdf';
  await storage.put({
    key: brochureKey,
    body: BROCHURE,
    contentType: 'application/pdf',
    metadata: { source: 'fixture', owner: 'user_editor' }
  });
  await createAs('media_brochure', {
    collection: 'media',
    data: {
      _storageKey: brochureKey,
      filename: 'brochure.pdf',
      url: await storage.getPublicUrl(brochureKey),
      contentType: 'application/pdf',
      filesize: BROCHURE.byteLength
    }
  });
}

// --- Posts: published with history, and a draft ---------------------------------------------------
const localeArg = SUPPORTS_LOCALIZED ? { locale: 'en' } : {};
await createAs('post_published', {
  collection: 'posts',
  ...localeArg,
  data: {
    title: 'Hello Forge',
    ...(SUPPORTS_LOCALIZED && { summary: 'Hello' }),
    body: [{ type: 'paragraph', children: [{ type: 'text', text: 'First published article.' }] }],
    seo: { description: 'The first article' },
    meta: {
      readingMinutes: 3,
      featured: true,
      blocks: [{ type: 'quote', text: 'Ship it' }]
    },
    category: 'category_news',
    tags: ['category_news', 'category_guides'],
    author: 'user_admin',
    hero: 'media_hero'
  }
});
tick();
await runtime.update({
  collection: 'posts',
  id: 'post_published',
  ...localeArg,
  data: { title: 'Hello Forge, revised' }
});
if (SUPPORTS_LOCALIZED) {
  tick();
  await runtime.update({
    collection: 'posts',
    id: 'post_published',
    locale: 'es',
    data: { summary: 'Hola' }
  });
}
tick();
await runtime.update({
  collection: 'posts',
  id: 'post_published',
  data: { _status: 'published' }
});

await createAs('post_draft', {
  collection: 'posts',
  ...localeArg,
  data: {
    title: 'Unfinished draft',
    ...(SUPPORTS_LOCALIZED && { summary: 'Draft summary' }),
    body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Not public yet.' }] }],
    category: 'category_guides',
    tags: [],
    author: 'user_editor'
  }
});

// --- Global --------------------------------------------------------------------------------------
tick();
await runtime.updateGlobalDocument({
  global: 'settings',
  data: {
    siteName: 'Forge Fixture Site',
    tagline: 'Upgrades without surprises'
  }
});

// --- Dump ----------------------------------------------------------------------------------------
const libsqlClient =
  PROFILE === 'libsql'
    ? (await import('@libsql/client')).createClient({ url: `file:${join(workDir, 'fixture.db')}` })
    : undefined;
async function all(sql) {
  if (PROFILE === 'd1-r2') return (await d1.prepare(sql).all()).results;
  const result = await libsqlClient.execute(sql);
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c) => [c, row[c]])));
}

const objects = await all(
  `SELECT "type", "name", "tbl_name", "sql" FROM "sqlite_master" ` +
    `WHERE "name" NOT LIKE 'sqlite_%' AND "name" NOT LIKE '_cf_%' AND "sql" IS NOT NULL ` +
    `ORDER BY CASE "type" WHEN 'table' THEN 0 ELSE 1 END, "name"`
);
const lines = [
  `-- ForgeCMS upgrade fixture, written through the published @forge-cms/*@${VERSION} packages.`,
  '-- Generated by apps/upgrade-rehearsal/generator (pnpm fixtures:upgrade:generate). Never edit by hand.'
];
const counts = {};
for (const obj of objects.filter((o) => o.type === 'table')) {
  lines.push(`${obj.sql};`);
  const columns = (await all(`PRAGMA table_info("${obj.name}")`)).map((c) => c.name);
  const quoted = columns.map((c) => `quote("${c}")`).join(` || ',' || `);
  const rows = await all(`SELECT ${quoted} AS "v" FROM "${obj.name}" ORDER BY rowid`);
  counts[obj.name] = rows.length;
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  for (const row of rows)
    lines.push(`INSERT INTO "${obj.name}" (${columnList}) VALUES (${row.v});`);
}
for (const obj of objects.filter((o) => o.type !== 'table')) lines.push(`${obj.sql};`);
const databaseSql = `${lines.join('\n')}\n`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const storageDir = join(OUT, 'storage');
rmSync(storageDir, { recursive: true, force: true });
mkdirSync(storageDir, { recursive: true });
const storageEntries = [];
// The objects the content needs: every stored `_storageKey` — never a bucket listing (spec 073 §6).
const keys = (
  await all(`SELECT "_storageKey" AS "key" FROM "media" WHERE "_storageKey" IS NOT NULL`)
)
  .map((row) => row.key)
  .sort();
for (const key of keys) {
  const object = await storage.get(key);
  if (!object) throw new Error(`object ${key} referenced by media is missing`);
  const body = new Uint8Array(object.body);
  const file = `${sha256(key)}.bin`;
  writeFileSync(join(storageDir, file), body);
  storageEntries.push({
    key,
    file: `storage/${file}`,
    sha256: sha256(body),
    size: body.byteLength,
    contentType: object.contentType ?? null,
    metadata: object.metadata ?? {}
  });
}
writeFileSync(join(OUT, 'database.sql'), databaseSql);
writeFileSync(join(OUT, 'storage-manifest.json'), `${JSON.stringify(storageEntries, null, 2)}\n`);

libsqlClient?.close();
await miniflare?.dispose();
rmSync(workDir, { recursive: true, force: true });

process.stdout.write(
  JSON.stringify({
    counts,
    log,
    apiKeys: {
      active: {
        id: ciKey.apiKey.id,
        secret: ciKey.secret,
        prefix: ciKey.apiKey.prefix
      },
      revoked: { id: revokedKey.apiKey.id, secret: revokedKey.secret }
    },
    credentials: { admin: CREDENTIALS.admin, editor: CREDENTIALS.editor },
    features: {
      localized: SUPPORTS_LOCALIZED,
      bootstrapClaim: atLeast(0, 5),
      uploadIntents: HAS_UPLOAD_INTENTS,
      fullVersionSnapshots: atLeast(0, 6),
      schemaBaseline: atLeast(0, 8),
      appWrittenObjectWithMetadata: !atLeast(0, 6)
    }
  })
);
