import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { isMigrationError, type MigrationRecord, type SchemaPlan } from '@forge-cms/db';
import {
  UniqueConstraintError,
  handleCreate,
  handleFile,
  handleMe,
  handleRead
} from '@forge-cms/runtime';
import type { Fixture } from './fixtures.js';
import { sha256Hex } from './fixtures.js';
import { canonicalMetadata } from './backup.js';
import { migrations } from './model.js';
import { REHEARSAL_AUTH_SECRET, type Installation } from './runtime.js';

/** The fixed content every historical fixture carries (spec 073 §4). */
export const IDS = {
  users: ['user_admin', 'user_editor'],
  categories: ['category_news', 'category_guides'],
  media: ['media_hero', 'media_brochure'],
  posts: ['post_published', 'post_draft']
} as const;

const PUBLISHED_BODY = [
  { type: 'paragraph', children: [{ type: 'text', text: 'First published article.' }] }
];
const PUBLISHED_META = {
  readingMinutes: 3,
  featured: true,
  blocks: [{ type: 'quote', text: 'Ship it' }]
};

const http = (path: string, init: RequestInit = {}) =>
  new Request(`http://rehearsal.test${path}`, init);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function count(installation: Installation, table: string): Promise<number> {
  const [row] = await installation.sql(`SELECT COUNT(*) AS "n" FROM "${table}"`);
  return Number(row?.['n']);
}

/** Row counts the rehearsal compares across upgrade and restore (spec 073 §39). */
export async function countRows(installation: Installation): Promise<Record<string, number>> {
  const tables = [
    'users',
    'categories',
    'media',
    'posts',
    '_versions_posts',
    '_global_settings',
    '_forge_api_keys',
    '_forge_migrations',
    '_forge_storage_intents'
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table] = await count(installation, table);
  return counts;
}

/** The historical data as found, before any migration: the counts the fixture manifest recorded. */
export async function expectFixtureCounts(installation: Installation, fixture: Fixture) {
  for (const [table, expected] of Object.entries(fixture.manifest.counts)) {
    expect(await count(installation, table), table).toBe(expected);
  }
}

/**
 * The drift the current configuration sees in a historical database: exactly the three application
 * changes the reviewed migrations exist for, and nothing else that blocks.
 */
export function expectPreUpgradePlan(plan: SchemaPlan) {
  const blocking = plan.changes
    .filter((c) => c.classification === 'manual-migration' || c.classification === 'unsupported')
    .map((c) => `${c.table}.${c.target.name} ${c.kind}`)
    .sort();
  expect(blocking).toEqual([
    'categories.idx_categories_slug index-changed',
    'categories.label column-removed',
    'categories.name column-added',
    'media.alt column-added'
  ]);
}

/** After the upgrade (and after a restore): nothing left to do, the ledger is exactly our array. */
export async function expectCleanSchemaAndLedger(installation: Installation) {
  const plan = await installation.runtime.planSchema();
  expect(plan.blocking).toBe(false);
  expect(plan.changes).toEqual([]);
  const history = await installation.runtime.readMigrationHistory();
  expect(history.map((h) => [h.position, h.id, h.status])).toEqual(
    migrations.map((m, i) => [i + 1, m.id, 'applied'])
  );
  return history;
}

/** Re-running the same array applies nothing: every migration is `already-applied`. */
export async function expectMigrationsAlreadyApplied(
  installation: Installation,
  history: readonly MigrationRecord[]
) {
  const report = await installation.runtime.runMigrations(migrations, { allowDestructive: true });
  expect(report.results.map((r) => r.outcome)).toEqual(migrations.map(() => 'already-applied'));
  expect(report.after.changes).toEqual([]);
  expect(await installation.runtime.readMigrationHistory()).toEqual(history);
  // An edited migration is still caught after the upgrade/restore — the checksums survived too.
  const [first, ...rest] = migrations;
  const edited = { ...first!, statements: [{ sql: `${first!.statements[0]!.sql} ` }] };
  await expect(installation.runtime.runMigrations([edited, ...rest])).rejects.toSatisfy(
    (err: unknown) => isMigrationError(err) && err.code === 'MIGRATION_CHECKSUM_MISMATCH'
  );
}

/** Historical credentials still work: password login, session, `/me`, role; API keys; no new admin. */
export async function expectHistoricalAuth(installation: Installation, fixture: Fixture) {
  const { admin, editor, apiKeys } = fixture.manifest.testCredentials;
  for (const [account, id, role] of [
    [admin, 'user_admin', 'admin'],
    [editor, 'user_editor', 'editor']
  ] as const) {
    const login = await installation.users.login(account.email, account.password);
    if (!login.ok) throw new Error(`historical login failed for ${account.email}: ${login.reason}`);
    expect(login.user.id).toBe(id);
    expect(login.user.role).toBe(role);
    const session = await installation.users.validateSession(login.token);
    expect(session?.user.id).toBe(id);
    const me = await handleMe(
      { request: http('/api/auth/me', { headers: bearer(login.token) }), env: {} },
      { runtime: installation.runtime }
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { data: { id: string; role: string } };
    expect(body.data).toMatchObject({ id, role });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  }
  const wrong = await installation.users.login(admin.email, `${admin.password}-wrong`);
  expect(wrong.ok).toBe(false);

  // The stored hash was not rewritten by the upgrade (it is only ever read).
  const [adminRow] = await installation.sql(
    `SELECT "passwordHash" AS "h" FROM "users" WHERE "id" = 'user_admin'`
  );
  expect(String(adminRow?.['h'])).toBe(fixturePasswordHash(fixture, 'user_admin'));

  const active = await installation.apiKeys.validateSession(apiKeys.active.token);
  expect(active?.user).toMatchObject({ id: apiKeys.active.id, scopes: ['content:read'] });
  expect(await installation.apiKeys.validateSession(apiKeys.revoked.token)).toBeNull();

  const admins = await installation.runtime.find({ collection: 'users', where: { role: 'admin' } });
  expect(admins.docs.map((u) => u['id'])).toEqual(['user_admin']);
}

/** The password hash exactly as the historical release stored it, read from the fixture SQL. */
function fixturePasswordHash(fixture: Fixture, userId: string): string {
  const line = fixture.databaseSql
    .split('\n')
    .find((l) => l.startsWith('INSERT INTO "users"') && l.includes(`VALUES ('${userId}'`));
  if (!line) throw new Error(`fixture has no users row for ${userId}`);
  const hash = /'([A-Za-z0-9_-]{40,})'/.exec(line)?.[1];
  if (!hash) throw new Error(`no password hash in the fixture row of ${userId}`);
  return hash;
}

/** Stable identities: every fixture id is still there, unchanged, in the right table. */
export async function expectStableIds(installation: Installation, fixture: Fixture) {
  for (const [table, ids] of Object.entries(IDS)) {
    const rows = await installation.sql(`SELECT "id" FROM "${table}" ORDER BY "id"`);
    const present = rows.map((r) => String(r['id']));
    for (const id of ids) expect(present, `${table} keeps ${id}`).toContain(id);
  }
  const versionIds = fixture.databaseSql
    .split('\n')
    .filter((l) => l.startsWith('INSERT INTO "_versions_posts"'))
    .map((l) => /VALUES \('([^']+)'/.exec(l)?.[1]);
  const rows = await installation.sql(`SELECT "id", "documentId" FROM "_versions_posts"`);
  const stored = new Map(rows.map((r) => [String(r['id']), String(r['documentId'])]));
  for (const id of versionIds) expect(stored.has(String(id)), `version ${id}`).toBe(true);
  const keyRows = await installation.sql(`SELECT "id" FROM "_forge_api_keys" ORDER BY "id"`);
  expect(keyRows.map((r) => r['id'])).toEqual([
    fixture.manifest.testCredentials.apiKeys.active.id,
    fixture.manifest.testCredentials.apiKeys.revoked.id
  ]);
}

/** The historical content, as the fixture wrote it, read back through the current Local API. */
export async function expectHistoricalContent(installation: Installation, fixture: Fixture) {
  const { runtime } = installation;
  const post = await runtime.findByID({ collection: 'posts', id: 'post_published', depth: 1 });
  expect(post).toMatchObject({
    id: 'post_published',
    _status: 'published',
    title: 'Hello Forge, revised',
    slug: 'hello-forge',
    body: PUBLISHED_BODY,
    seo: { description: 'The first article' },
    meta: PUBLISHED_META
  });
  // Relations: target ids unchanged, populated through the current code.
  expect(post['category']).toMatchObject({ id: 'category_news', name: 'News', slug: 'news' });
  expect((post['tags'] as { id: string }[]).map((t) => t.id)).toEqual([
    'category_news',
    'category_guides'
  ]);
  expect(post['author']).toMatchObject({ id: 'user_admin' });
  expect(post['hero']).toMatchObject({ id: 'media_hero', filename: 'hero.png', alt: 'hero.png' });

  const draft = await runtime.findByID({ collection: 'posts', id: 'post_draft' });
  expect(draft).toMatchObject({
    _status: 'draft',
    title: 'Unfinished draft',
    category: 'category_guides',
    tags: [],
    author: 'user_editor'
  });

  const categories = await runtime.find({ collection: 'categories', sort: 'name' });
  expect(categories.docs.map((c) => [c['id'], c['name'], c['slug']])).toEqual([
    ['category_guides', 'Guides', 'guides'],
    ['category_news', 'News', 'news']
  ]);

  // Localized values: preserved byte for byte in storage, and resolved per locale on read.
  const [raw] = await installation.sql(
    `SELECT "summary" FROM "posts" WHERE "id" = 'post_published'`
  );
  if (fixture.manifest.features.localized) {
    expect(raw?.['summary']).toBe('{"en":"Hello","es":"Hola"}');
    expect(
      (await runtime.findByID({ collection: 'posts', id: 'post_published', locale: 'es' }))[
        'summary'
      ]
    ).toBe('Hola');
    expect(
      (await runtime.findByID({ collection: 'posts', id: 'post_published', locale: 'en' }))[
        'summary'
      ]
    ).toBe('Hello');
  } else {
    expect(raw?.['summary']).toBeNull();
  }

  const settings = await runtime.getGlobalDocument({ global: 'settings' });
  expect(settings).toMatchObject({
    siteName: 'Forge Fixture Site',
    tagline: 'Upgrades without surprises'
  });
}

/** Anonymous callers see only published posts; trusted and editor reads see drafts too. */
export async function expectDraftVisibility(
  installation: Installation,
  fixture: Fixture,
  expected: { published: string[]; all: string[] }
) {
  const { runtime } = installation;
  const anonymous = await runtime.find({
    collection: 'posts',
    overrideAccess: false,
    user: null,
    sort: 'id'
  });
  expect(anonymous.docs.map((d) => d['id'])).toEqual(expected.published);
  // Asking for drafts does not unlock them for an anonymous caller.
  const anonymousAll = await runtime.find({
    collection: 'posts',
    overrideAccess: false,
    user: null,
    status: 'all',
    sort: 'id'
  });
  expect(anonymousAll.docs.map((d) => d['id'])).toEqual(expected.published);
  const trusted = await runtime.find({ collection: 'posts', sort: 'id' });
  expect(trusted.docs.map((d) => d['id'])).toEqual(expected.all);
  const editor = await installation.users.login(
    fixture.manifest.testCredentials.editor.email,
    fixture.manifest.testCredentials.editor.password
  );
  if (!editor.ok) throw new Error('editor login failed');
  const asEditor = await runtime.find({
    collection: 'posts',
    overrideAccess: false,
    user: editor.user,
    status: 'all',
    sort: 'id'
  });
  expect(asEditor.docs.map((d) => d['id'])).toEqual(expected.all);
}

/** Referential integrity still holds on upgraded data, and HTTP responses never carry a hash. */
export async function expectIntegrityAndProjection(installation: Installation) {
  const { runtime } = installation;
  const categoriesBefore = await count(installation, 'categories');
  await expect(runtime.delete({ collection: 'categories', id: 'category_news' })).rejects.toThrow(
    /referenced by/
  );
  expect(await count(installation, 'categories')).toBe(categoriesBefore);
  const response = await handleRead(
    {
      request: http('/api/v1/posts/post_published?depth=1'),
      params: { collection: 'posts', id: 'post_published' },
      env: {}
    },
    { runtime }
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('Hello Forge');
  expect(text).not.toContain('passwordHash');
  expect(text).not.toContain('_sessionVersion');
}

/**
 * Every file the fixture's content references is readable with identical bytes, content type and
 * custom metadata — through the storage adapter and through `handleFile`, which also checks that a
 * document owns the key.
 */
export async function expectFiles(
  installation: Installation,
  objects: Fixture['objects'],
  token: string
) {
  for (const object of objects) {
    const rows = await installation.sql(
      `SELECT "id" FROM "media" WHERE "_storageKey" = '${object.key.replaceAll("'", "''")}'`
    );
    expect(rows, `a media document owns ${object.key}`).toHaveLength(1);
    const stored = await installation.storage.get(object.key);
    if (!stored?.body) throw new Error(`object ${object.key} is missing`);
    expect(sha256Hex(new Uint8Array(stored.body))).toBe(object.sha256);
    expect(stored.contentType ?? null).toBe(object.contentType);
    expect(canonicalMetadata(stored.metadata)).toBe(canonicalMetadata(object.metadata));

    const response = await handleFile(
      {
        request: http(`/api/media/${object.key}`, { headers: bearer(token) }),
        params: { key: object.key },
        env: {}
      },
      { runtime: installation.runtime }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(object.contentType);
    expect(sha256Hex(new Uint8Array(await response.arrayBuffer()))).toBe(object.sha256);
  }
}

export async function loginAdmin(installation: Installation, fixture: Fixture) {
  const { admin } = fixture.manifest.testCredentials;
  const login = await installation.users.login(admin.email, admin.password);
  if (!login.ok) throw new Error(`admin login failed: ${login.reason}`);
  return login;
}

/** What {@link applyPostUpgradeWrites} leaves behind, for re-verification after a restore. */
export interface PostUpgradeWrites {
  viewerId: string;
}

/**
 * Proves the upgraded historical data is writable, not merely readable (spec 073 §41): edit, localized
 * write, create with relations, publish a draft, update the global, a new signup (who must not become
 * an admin), and the unique slug the reviewed migration introduced.
 */
export async function applyPostUpgradeWrites(
  installation: Installation,
  fixture: Fixture
): Promise<PostUpgradeWrites> {
  const { runtime, users } = installation;
  const admin = await loginAdmin(installation, fixture);
  const asAdmin = { user: admin.user, overrideAccess: false } as const;

  await runtime.update({
    collection: 'posts',
    id: 'post_published',
    ...asAdmin,
    data: { title: 'Hello Forge, upgraded' }
  });
  await runtime.update({
    collection: 'posts',
    id: 'post_published',
    locale: 'en',
    data: { summary: 'Hello' }
  });
  await runtime.update({
    collection: 'posts',
    id: 'post_published',
    locale: 'es',
    data: { summary: 'Hola, otra vez' }
  });
  await runtime.create({
    collection: 'posts',
    data: {
      id: 'post_after_upgrade',
      title: 'Written after the upgrade',
      body: [{ type: 'paragraph', children: [{ type: 'text', text: 'New content.' }] }],
      category: 'category_guides',
      tags: ['category_news'],
      author: 'user_editor',
      hero: 'media_brochure',
      _status: 'published'
    }
  });
  await runtime.update({
    collection: 'posts',
    id: 'post_draft',
    ...asAdmin,
    data: { _status: 'published' }
  });
  await runtime.updateGlobalDocument({
    global: 'settings',
    data: { tagline: 'Upgraded in place' }
  });

  await runtime.create({
    collection: 'categories',
    data: { id: 'category_releases', name: 'Releases' }
  });
  // The unique slug index exists now (migration 002 + post-flight sync): a second "News" collides.
  await expect(
    runtime.create({ collection: 'categories', data: { name: 'News' } })
  ).rejects.toSatisfy((err: unknown) => err instanceof UniqueConstraintError);

  const viewer = await users.createUser({
    email: 'viewer@fixture.test',
    password: 'fixture-viewer-password',
    name: 'Signed up after the upgrade'
  });
  if (!viewer.ok) throw new Error(`signup failed: ${viewer.reason}`);
  expect(viewer.user.role).not.toBe('admin');
  return { viewerId: viewer.user.id };
}

/** The state {@link applyPostUpgradeWrites} produced — checked again on a restored copy. */
export async function expectPostUpgradeWrites(
  installation: Installation,
  writes: PostUpgradeWrites
) {
  const { runtime } = installation;
  const post = await runtime.findByID({ collection: 'posts', id: 'post_published', locale: 'es' });
  expect(post).toMatchObject({
    title: 'Hello Forge, upgraded',
    summary: 'Hola, otra vez',
    _status: 'published'
  });
  const [raw] = await installation.sql(
    `SELECT "summary" FROM "posts" WHERE "id" = 'post_published'`
  );
  expect(JSON.parse(String(raw?.['summary']))).toEqual({ en: 'Hello', es: 'Hola, otra vez' });
  expect(
    await runtime.findByID({ collection: 'posts', id: 'post_after_upgrade', depth: 1 })
  ).toMatchObject({
    title: 'Written after the upgrade',
    category: { id: 'category_guides' },
    hero: { id: 'media_brochure' }
  });
  expect((await runtime.getGlobalDocument({ global: 'settings' }))?.['tagline']).toBe(
    'Upgraded in place'
  );
  const viewer = await runtime.findByID({ collection: 'users', id: writes.viewerId });
  expect(viewer['role']).not.toBe('admin');
  const admins = await runtime.find({ collection: 'users', where: { role: 'admin' } });
  expect(admins.docs.map((u) => u['id'])).toEqual(['user_admin']);
  const releases = await runtime.findByID({ collection: 'categories', id: 'category_releases' });
  expect(releases['slug']).toBe('releases');
}

/**
 * History survives and restore works on it (spec 073 §42). Version 1 of `post_published` is the
 * historical create; from 0.4.0 its later versions are pre-062 patches. Restoring version 1 applies
 * what it contains — including `_status: 'draft'` — and appends a new full snapshot.
 */
export async function expectHistoryAndRestore(installation: Installation, fixture: Fixture) {
  const { runtime } = installation;
  const history = await runtime.listVersions({ collection: 'posts', documentId: 'post_published' });
  const expectedVersions = fixture.manifest.features.fullVersionSnapshots ? 4 : 3;
  expect(history.map((v) => v.versionNumber)).toEqual(
    Array.from({ length: expectedVersions }, (_, i) => expectedVersions - i)
  );
  const [latest] = history;
  const first = history.at(-1)!;
  expect(first.data).toMatchObject({ title: 'Hello Forge', _status: 'draft' });
  if (fixture.manifest.features.fullVersionSnapshots) {
    // Full snapshots (spec 062): the newest one holds the whole document.
    expect(latest!.data).toMatchObject({ title: 'Hello Forge, revised', _status: 'published' });
  } else {
    // Pre-062 history: each update stored only the patch it applied.
    expect(latest!.data).toEqual({ _status: 'published' });
    expect(history[1]!.data).toEqual({ title: 'Hello Forge, revised' });
  }

  const restored = await runtime.restoreVersion({ collection: 'posts', versionId: first.id });
  expect(restored).toMatchObject({ id: 'post_published', title: 'Hello Forge', _status: 'draft' });
  const after = await runtime.listVersions({ collection: 'posts', documentId: 'post_published' });
  expect(after).toHaveLength(expectedVersions + 1);
  expect(after[0]!.versionNumber).toBe(expectedVersions + 1);
  expect(after[0]!.data).toMatchObject({
    title: 'Hello Forge',
    _status: 'draft',
    slug: 'hello-forge'
  });
  // Publish it again, so later checks see the published article.
  await runtime.update({
    collection: 'posts',
    id: 'post_published',
    data: { _status: 'published' }
  });
}

/**
 * Leaves one real pending storage intent (spec 067): an upload through the HTTP handler, then a
 * delete while the object store is failing. The document is gone; its object and a `delete` intent
 * remain for `reconcileStorage()`. Returns the orphaned key.
 */
export async function leavePendingStorageIntent(
  installation: Installation,
  token: string
): Promise<string> {
  const form = new FormData();
  form.set(
    'file',
    new File([new TextEncoder().encode('temporary object')], 'temp.txt', { type: 'text/plain' })
  );
  form.set('alt', 'Temporary upload');
  const response = await handleCreate(
    {
      request: http('/api/v1/media', { method: 'POST', headers: bearer(token), body: form }),
      params: { collection: 'media' },
      env: {}
    },
    { runtime: installation.runtime }
  );
  expect(response.status).toBe(201);
  const doc = ((await response.json()) as { data: { id: string; _storageKey: string } }).data;
  installation.storage.failDeletes = true;
  try {
    await installation.runtime.delete({ collection: 'media', id: doc.id });
  } finally {
    installation.storage.failDeletes = false;
  }
  expect(await count(installation, '_forge_storage_intents')).toBe(1);
  expect(await installation.storage.get(doc._storageKey)).not.toBeNull();
  return doc._storageKey;
}

/** The version of the ForgeCMS packages under test (the workspace `@forge-cms/runtime`). */
export function currentForgeVersion(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@forge-cms/runtime');
  const manifest = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

/** A backup manifest must never carry a secret (spec 073 §21). */
export function expectNoSecrets(text: string, fixture: Fixture) {
  const { admin, editor, apiKeys } = fixture.manifest.testCredentials;
  for (const secret of [
    REHEARSAL_AUTH_SECRET,
    admin.password,
    editor.password,
    apiKeys.active.token,
    apiKeys.revoked.token
  ]) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/passwordHash|secretHash|CLOUDFLARE_|cookie/i);
}
