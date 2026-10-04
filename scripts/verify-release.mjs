import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const publicPackages = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/angular',
  '@forge-cms/admin',
  '@forge-cms/testing'
];

const workspaceOnlyProtocols = ['workspace:', 'catalog:', 'link:', 'file:'];
const repoRoot = process.cwd();
const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-release-'));
const packDir = join(workDir, 'packs');

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true',
      ...options.env
    }
  });
}

function runQuiet(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      ...options.env
    }
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(`${path}`, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  throw new Error(message);
}

function sanitizePackageName(name) {
  return name.replace('@', '').replace('/', '-');
}

function listFiles(dir) {
  const output = [];
  const stack = [''];

  while (stack.length > 0) {
    const relative = stack.pop();
    const absolute = join(dir, relative);

    for (const entry of readdirSync(absolute)) {
      const entryRelative = relative ? `${relative}/${entry}` : entry;
      const entryAbsolute = join(dir, entryRelative);
      const stat = statSync(entryAbsolute);
      if (stat.isDirectory()) {
        stack.push(entryRelative);
      } else {
        output.push(entryRelative);
      }
    }
  }

  return output.sort();
}

// Deliberately excludes `devDependencies`: this feeds `assertRuntimeImportsDeclared`, which checks
// what a real npm install of the *published* package resolves — devDependencies are never installed
// for a consumer, so a package whose compiled runtime code imports another `@forge-cms/*` package
// declared only as a devDependency would resolve locally (pnpm hoists devDeps into node_modules) but
// break for every real external consumer with `ERR_MODULE_NOT_FOUND`.
function dependencySections(pkg) {
  return [pkg.dependencies ?? {}, pkg.peerDependencies ?? {}, pkg.optionalDependencies ?? {}];
}

function assertNoWorkspaceProtocols(pkg, label) {
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (workspaceOnlyProtocols.some((protocol) => String(range).startsWith(protocol))) {
        fail(`${label} has unresolved ${section}.${name}: ${range}`);
      }
    }
  }
}

function assertRuntimeImportsDeclared(pkg, files, packageDir) {
  const declared = new Set(dependencySections(pkg).flatMap((section) => Object.keys(section)));

  for (const file of files.filter(
    (candidate) => candidate.startsWith('dist/') && candidate.endsWith('.js')
  )) {
    const source = readFileSync(join(packageDir, file), 'utf8');
    const imports = source.matchAll(/(?:from\s+|import\s*\()\s*['"](@forge-cms\/[^'"]+)['"]/g);

    for (const match of imports) {
      const importedPackage = match[1];
      if (importedPackage === pkg.name || importedPackage.startsWith(`${pkg.name}/`)) continue;
      const packageName = importedPackage.split('/').slice(0, 2).join('/');
      if (!declared.has(packageName)) {
        fail(`${pkg.name} imports ${packageName} from ${file} but does not declare it`);
      }
    }
  }
}

function assertPackedContents(pkg, files, packageDir) {
  if (!files.includes('package.json')) fail(`${pkg.name} tarball is missing package.json`);
  if (!files.includes('README.md')) fail(`${pkg.name} tarball is missing README.md`);
  if (!files.includes('dist/index.js')) fail(`${pkg.name} tarball is missing dist/index.js`);
  if (!files.includes('dist/index.d.ts')) fail(`${pkg.name} tarball is missing dist/index.d.ts`);

  if (files.some((file) => file.startsWith('src/'))) {
    fail(`${pkg.name} tarball includes src/ files`);
  }

  if (files.some((file) => file.startsWith('apps/') || file.startsWith('packages/'))) {
    fail(`${pkg.name} tarball includes workspace paths`);
  }

  assertRuntimeImportsDeclared(pkg, files, packageDir);
  assertTypeOnlyCoreDependency(pkg, files, packageDir);
}

// Spec 076: `@forge-cms/angular` depends on `@forge-cms/core` for **types only**. Its packed JavaScript
// must never import core (a browser bundle would pull in server-side validation code), while its
// declarations must, and the dependency must be declared so a consumer's compiler resolves them.
function assertTypeOnlyCoreDependency(pkg, files, packageDir) {
  if (pkg.name !== '@forge-cms/angular') return;
  if (!pkg.dependencies?.['@forge-cms/core']) {
    fail(
      '@forge-cms/angular must declare @forge-cms/core in dependencies (its .d.ts files import it)'
    );
  }
  let declarationsUseCore = false;
  for (const file of files) {
    const source = readFileSync(join(packageDir, file), 'utf8');
    const importsCore = /(?:from\s+|import\s*\()\s*['"]@forge-cms\/core['"]/.test(source);
    if (file.endsWith('.js') && importsCore) {
      fail(`@forge-cms/angular ${file} imports @forge-cms/core at runtime; it must be type-only`);
    }
    if (file.endsWith('.d.ts') && importsCore) declarationsUseCore = true;
  }
  if (!declarationsUseCore)
    fail('@forge-cms/angular declarations no longer reference @forge-cms/core');
}

function parseDependencySpec(spec) {
  const at = spec.startsWith('@') ? spec.lastIndexOf('@') : spec.indexOf('@');
  if (at <= 0) return [spec, 'latest'];
  return [spec.slice(0, at), spec.slice(at + 1)];
}

function installConsumer(name, forgeTarballs, extraDependencies) {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });

  const forgeDependencies = Object.fromEntries(
    forgeTarballs.map((tarball) => [tarball.name, `file:${tarball.path}`])
  );
  const dependencies = {
    ...forgeDependencies,
    ...Object.fromEntries(extraDependencies.map((spec) => parseDependencySpec(spec)))
  };

  writeJson(join(dir, 'package.json'), {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'tsc -p tsconfig.json'
    },
    dependencies,
    pnpm: {
      overrides: forgeDependencies
    }
  });

  run('pnpm', ['install'], { cwd: dir });
  return dir;
}

function writeBaseTsconfig(dir, extra = {}) {
  writeJson(join(dir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      outDir: 'dist',
      ...extra
    },
    include: ['src/**/*.ts']
  });
}

function verifyRuntimeConsumer(tarballs) {
  const dir = installConsumer('runtime-consumer', tarballs, ['typescript@5.9.2']);

  const srcDir = join(dir, 'src');
  run('mkdir', ['-p', srcDir]);
  writeBaseTsconfig(dir);
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { defineCollection, defineField } from '@forge-cms/core';
import {
  InMemoryDatabaseAdapter,
  AtomicWriteConditionError,
  ATOMIC_WRITE_MAX_OPERATIONS
} from '@forge-cms/db';
import type { AtomicWriteOperation } from '@forge-cms/db';
import {
  InMemoryAuthAdapter,
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter,
  defineUsersCollection,
  hasScope
} from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  AuthManagedCollectionError,
  ConcurrentModificationError,
  ForgeCmsRuntime,
  UniqueConstraintError,
  handleDelete,
  handleLogin,
  handleSignup,
  handleLogout,
  handleMe
} from '@forge-cms/runtime';

const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    data: defineField.json(),
    group: defineField.text({ required: true }),
    key: defineField.text({ required: true })
  },
  indexes: [
    {
      fields: ['group', 'key'],
      unique: true
    }
  ]
});

// Typed Local API (spec 047): a typed JSON generic and full slug/field/return-type inference,
// proven through the packed public exports only (no deep imports).
const articles = defineCollection({
  slug: 'articles',
  fields: {
    title: defineField.text({ required: true }),
    metadata: defineField.json<{ featured: boolean }>()
  }
});

const runtime = new ForgeCmsRuntime({
  collections: [notes, articles],
  adapters: {
    database: new InMemoryDatabaseAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter()
  }
});

runtime.init();
await runtime.syncSchema();

const created = await runtime.create({
  collection: 'notes',
  data: { title: 'First note', data: { source: 'packed-artifact' }, group: 'g1', key: 'k1' }
});

const listed = await runtime.find({ collection: 'notes' });
if (listed.docs.length !== 1) throw new Error('Expected one note after create');

const updated = await runtime.update({
  collection: 'notes',
  id: String(created.id),
  data: { title: 'Updated note' }
});
if (updated.title !== 'Updated note') throw new Error('Update did not persist');

// Compound unique index (spec 046): the exact (group, key) combination must be rejected.
let conflictError;
try {
  await runtime.create({
    collection: 'notes',
    data: { title: 'Duplicate', group: 'g1', key: 'k1' }
  });
} catch (err) {
  conflictError = err;
}
if (!(conflictError instanceof UniqueConstraintError)) {
  throw new Error('Expected a UniqueConstraintError for a duplicate (group, key) combination');
}
if (conflictError.status !== 409 || conflictError.code !== 'UNIQUE_CONSTRAINT') {
  throw new Error('UniqueConstraintError did not carry the expected status/code');
}

// A different key in the same group must still be allowed.
await runtime.create({ collection: 'notes', data: { title: 'Other key', group: 'g1', key: 'k2' } });

await runtime.delete({ collection: 'notes', id: String(created.id) });
const afterDelete = await runtime.find({ collection: 'notes' });
if (afterDelete.docs.length !== 1) throw new Error('Expected one note (the other key) after delete');

// Typed Local API (spec 047): defineCollection's inference reaches find/create/update through the
// packed public surface. These assignments only compile if the packed types are actually inferred
// (an untyped/'any' fallback would not narrow 'title' to string or 'metadata' to the JSON generic).
const article = await runtime.create({
  collection: 'articles',
  data: { title: 'Typed Forge', metadata: { featured: true } }
});
const articleTitle: string = article.title;
const articleFeatured: boolean = article.metadata.featured;
if (articleTitle !== 'Typed Forge' || articleFeatured !== true) {
  throw new Error('Typed article create did not round-trip as expected');
}

// Compile-time-only negative assertions: declared but never invoked, so they cannot affect the
// runtime assertions above. Removing any @ts-expect-error here would fail 'tsc -p tsconfig.json'.
async function typedLocalApiRejections(rt: typeof runtime) {
  // @ts-expect-error - unknown collection is rejected
  await rt.find({ collection: 'does-not-exist' });
  // @ts-expect-error - wrong field value type is rejected
  await rt.create({ collection: 'articles', data: { metadata: 'not-an-object' } });
  // @ts-expect-error - unknown field name is rejected
  await rt.create({ collection: 'articles', data: { nope: 1 } });
}
void typedLocalApiRejections;

// Machine auth (spec 048): ApiKeyAuthAdapter + CompositeAuthAdapter + hasScope through the packed
// public surface only (no deep imports), proving a human strategy and an API key can coexist behind
// one configured AuthAdapter.
const machineAuthDb = new InMemoryDatabaseAdapter();
const humanAuth = new InMemoryAuthAdapter();
const apiKeyAuth = new ApiKeyAuthAdapter();
const composedAuth = new CompositeAuthAdapter([humanAuth, apiKeyAuth]);
composedAuth.init({ apiKeyDatabase: machineAuthDb });
await composedAuth.syncSchema();

const { secret } = await apiKeyAuth.createApiKey({
  name: 'packed-artifact-key',
  scopes: ['notes:read'],
  metadata: { source: 'packed-artifact' }
});

const machineRequest = new Request('https://forge.test', {
  headers: { authorization: \`Bearer \${secret}\` }
});
const machineUser = await composedAuth.requireAuth(machineRequest);
if (machineUser.role !== 'machine') throw new Error('Expected the API key to resolve to a machine principal');
if (!hasScope(machineUser, 'notes:read')) throw new Error('Expected machine principal to carry its configured scope');
if (hasScope(machineUser, 'notes:write')) throw new Error('Machine principal must not carry an unconfigured scope');
if (machineUser.metadata?.source !== 'packed-artifact') {
  throw new Error('Expected consumer-defined metadata to reach the authenticated principal');
}

const unauthenticatedRequest = new Request('https://forge.test');
let compositeRejected = false;
try {
  await composedAuth.requireAuth(unauthenticatedRequest);
} catch {
  compositeRejected = true;
}
if (!compositeRejected) throw new Error('Expected an unauthenticated request to be rejected');

// Query completeness & adapter parity (spec 050): nested and/or, findOne, multi-field sort, and
// relation-array containsValue, all through the packed public surface only.
const queryDb = new InMemoryDatabaseAdapter();
const articles2 = defineCollection({
  slug: 'articles2',
  fields: {
    title: defineField.text({ required: true }),
    category: defineField.text(),
    status: defineField.text(),
    featured: defineField.boolean(),
    views: defineField.number(),
    tags: defineField.relation({ collection: 'tags', many: true })
  }
});
// A relation must name a registered collection whose targets exist (spec 064).
const tags2 = defineCollection({ slug: 'tags', fields: { label: defineField.text() } });
const queryRuntime = new ForgeCmsRuntime({
  collections: [articles2, tags2],
  adapters: { database: queryDb, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
});
queryRuntime.init();
await queryRuntime.syncSchema();
for (const id of ['a', 'b']) {
  await queryDb.create('tags', { id, label: id });
}

await queryRuntime.create({
  collection: 'articles2',
  data: { title: 'News', category: 'news', status: 'published', featured: false, views: 50, tags: ['a'] }
});
await queryRuntime.create({
  collection: 'articles2',
  data: { title: 'Opinion', category: 'opinion', status: 'published', featured: true, views: 10, tags: ['b'] }
});
await queryRuntime.create({
  collection: 'articles2',
  data: { title: 'Draft', category: 'news', status: 'draft', featured: false, views: 200, tags: [] }
});

const nested = await queryRuntime.find({
  collection: 'articles2',
  where: { and: [{ status: 'published' }, { or: [{ category: 'news' }, { featured: true }] }] }
});
if (nested.docs.length !== 2) throw new Error('Expected a nested and/or where to match 2 documents');

const sorted = await queryRuntime.find({
  collection: 'articles2',
  sort: [
    { field: 'featured', order: 'desc' },
    { field: 'views', order: 'asc' }
  ]
});
if (sorted.docs.map((d) => d.title).join(',') !== 'Opinion,News,Draft') {
  throw new Error('Expected multi-field sort to order featured desc, then views asc');
}

const one = await queryRuntime.findOne({ collection: 'articles2', where: { category: 'opinion' } });
if (one?.title !== 'Opinion') throw new Error('Expected findOne to return the matching document');
const none = await queryRuntime.findOne({ collection: 'articles2', where: { category: 'nope' } });
if (none !== null) throw new Error('Expected findOne to return null for no match');

const membership = await queryRuntime.find({
  collection: 'articles2',
  where: { tags: { containsValue: 'a' } }
});
if (membership.docs.length !== 1 || membership.docs[0].title !== 'News') {
  throw new Error('Expected containsValue to filter by relation-array membership');
}

// Relation lifecycle (spec 064), through the packed public surface only: unsupported reference shapes
// are refused at startup, a missing target is refused, a cascade commits as one batch, and the
// \`assertCount\` batch operation guards across collections.
let nestedRejected = false;
try {
  new ForgeCmsRuntime({
    collections: [
      defineCollection({ slug: 'owners', fields: { name: defineField.text() } }),
      defineCollection({
        slug: 'nested',
        fields: {
          meta: defineField.group({ fields: { owner: defineField.relation({ collection: 'owners' }) } })
        }
      })
    ],
    adapters: { database: new InMemoryDatabaseAdapter(), auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
  });
} catch (error) {
  nestedRejected = error instanceof Error && error.message.includes("'meta.owner'");
}
if (!nestedRejected) throw new Error('Expected a nested relation to be refused at startup');

const relationDb = new InMemoryDatabaseAdapter();
const relationRuntime = new ForgeCmsRuntime({
  collections: [
    defineCollection({ slug: 'owners', fields: { name: defineField.text() } }),
    defineCollection({
      slug: 'things',
      fields: { owner: defineField.relation({ collection: 'owners', onDelete: 'cascade' }) }
    })
  ],
  adapters: { database: relationDb, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
});
relationRuntime.init();
await relationRuntime.syncSchema();
let missingTargetRejected = false;
try {
  await relationRuntime.create({ collection: 'things', data: { owner: 'ghost' } });
} catch (error) {
  missingTargetRejected = (error as { code?: string }).code === 'INVALID_INPUT';
}
if (!missingTargetRejected) throw new Error('Expected a missing relation target to be refused');
const owner = await relationRuntime.create({ collection: 'owners', data: { name: 'o' } });
await relationRuntime.create({ collection: 'things', data: { owner: owner.id } });
await relationRuntime.delete({ collection: 'owners', id: owner.id as string });
if ((await relationDb.count('things')) !== 0) throw new Error('Expected the cascade to commit');
let assertionFailed = false;
try {
  await relationDb.atomicWrite([
    { type: 'create', collection: 'owners', data: { name: 'x' } },
    { type: 'assertCount', collection: 'owners', equals: 0 }
  ]);
} catch (error) {
  assertionFailed = error instanceof AtomicWriteConditionError;
}
if (!assertionFailed || (await relationDb.count('owners')) !== 0) {
  throw new Error('Expected a failed assertCount to roll back the whole batch');
}

// Browser auth foundation (spec 053): defineUsersCollection + UsersCollectionAuthAdapter +
// handleSignup/handleLogin/handleMe/handleLogout + CSRF protection, all through the packed public
// surface only (no deep imports).
const authDb = new InMemoryDatabaseAdapter();
const usersAuth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: authDb });
const authRuntime = new ForgeCmsRuntime({
  collections: [defineUsersCollection()],
  adapters: { database: authDb, auth: usersAuth, storage: new InMemoryStorageAdapter() }
});
authRuntime.init();
await authRuntime.syncSchema();

const signupResponse = await handleSignup(
  {
    request: new Request('https://forge.test/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'password123', role: 'viewer' })
    }),
    env: {}
  },
  { runtime: authRuntime, enabled: true }
);
if (signupResponse.status !== 201) throw new Error('Expected signup to succeed with 201');
const signupBody = await signupResponse.json();
// First user ever, bootstrapped to admin regardless of the (ignored) role field in the body above.
if (signupBody.data.user.role !== 'admin') throw new Error('Expected the first signup to become admin');
const signupCookie = signupResponse.headers.get('set-cookie');
if (!signupCookie || !signupCookie.includes('HttpOnly') || !signupCookie.includes('forge_session=')) {
  throw new Error('Expected handleSignup to set an HttpOnly forge_session cookie');
}

// Spec 060: the first admin was provisioned as ONE atomic write — the bootstrap claim exists together
// with the admin, through the packed public surface.
if ((await authDb.count('_forge_bootstrap')) !== 1 || (await authDb.count('users', { role: 'admin' })) !== 1) {
  throw new Error('Expected exactly one bootstrap claim and one admin after the first signup');
}

// Spec 061, packed public surface: the users collection is owned by the auth adapter, so generic content
// CRUD cannot touch it — Local API (trusted default) and HTTP — while the dedicated surface still works.
if (usersAuth.managesCollection('users') !== true || usersAuth.managesCollection('posts') !== false) {
  throw new Error('Expected UsersCollectionAuthAdapter.managesCollection to claim exactly its own collection');
}
const onlyAdminId = signupBody.data.user.id;
let managedError;
try {
  await authRuntime.delete({ collection: 'users', id: onlyAdminId });
} catch (error) {
  managedError = error;
}
if (
  !(managedError instanceof AuthManagedCollectionError) ||
  managedError.code !== 'AUTH_MANAGED_COLLECTION' ||
  managedError.status !== 403 ||
  (await authDb.count('users')) !== 1
) {
  throw new Error('Expected a trusted generic delete of the auth-managed users collection to be refused');
}
const managedHttp = await handleDelete(
  {
    request: new Request('https://forge.test/api/v1/users/' + onlyAdminId, {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + signupBody.data.token }
    }),
    params: { collection: 'users', id: onlyAdminId },
    env: {}
  },
  { runtime: authRuntime }
);
if (managedHttp.status !== 403 || (await managedHttp.json()).error.code !== 'AUTH_MANAGED_COLLECTION') {
  throw new Error('Expected DELETE /api/v1/users/:id to answer 403 AUTH_MANAGED_COLLECTION');
}
if ((await authDb.count('users', { role: 'admin' })) !== 1) {
  throw new Error('Expected the only administrator to survive generic deletion');
}

// Atomic write batch (spec 060), packed public surface: all-or-nothing with typed errors.
const batchDb = new InMemoryDatabaseAdapter();
await batchDb.syncSchema([
  defineCollection({ slug: 'slots', fields: { key: defineField.text({ unique: true }) } })
]);
const batchOk = await batchDb.atomicWrite([
  { type: 'create', collection: 'slots', data: { id: 's1', key: 'a' } },
  { type: 'updateIf', collection: 'slots', id: 's1', data: { key: 'b' }, condition: { targetMatches: { key: 'a' } }, requireApplied: true }
] satisfies AtomicWriteOperation[]);
if (batchOk.map((r) => r.type).join() !== 'create,updateIf' || (await batchDb.findById('slots', 's1'))?.key !== 'b') {
  throw new Error('Expected the atomic write batch to commit in order and return ordered results');
}
let uniqueCode: unknown;
try {
  await batchDb.atomicWrite([
    { type: 'create', collection: 'slots', data: { id: 's2', key: 'c' } },
    { type: 'create', collection: 'slots', data: { id: 's3', key: 'b' } }
  ]);
} catch (error) {
  uniqueCode = (error as { code?: unknown }).code;
}
if (uniqueCode !== 'UNIQUE_CONSTRAINT' || (await batchDb.findById('slots', 's2')) !== null) {
  throw new Error('Expected a conflicting batch to reject with UniqueConstraintError and roll back');
}
let conditionError: unknown;
try {
  await batchDb.atomicWrite([
    { type: 'create', collection: 'slots', data: { id: 's4', key: 'd' } },
    { type: 'deleteIf', collection: 'slots', id: 's1', condition: { targetMatches: { key: 'nope' } }, requireApplied: true }
  ]);
} catch (error) {
  conditionError = error;
}
if (!(conditionError instanceof AtomicWriteConditionError) || (await batchDb.findById('slots', 's4')) !== null) {
  throw new Error('Expected requireApplied to fail the batch with AtomicWriteConditionError and roll back');
}
if (ATOMIC_WRITE_MAX_OPERATIONS !== 25) throw new Error('Expected the documented batch cap of 25');

// Spec 062, packed public surface: a versioned document and its snapshot are one atomic write, the
// snapshot is the full content, and a writer that loses the race gets ConcurrentModificationError with
// nothing written. The race is forced by committing a competing version right before the batch.
const historyStore = new InMemoryDatabaseAdapter();
let beforeBatch: (() => Promise<unknown>) | undefined;
const historyDb = new Proxy(historyStore, {
  get(target, property) {
    if (property === 'atomicWrite') {
      return async (operations: AtomicWriteOperation[]) => {
        const action = beforeBatch;
        beforeBatch = undefined;
        if (action) await action();
        return target.atomicWrite(operations);
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
const historyRuntime = new ForgeCmsRuntime({
  collections: [
    defineCollection({
      slug: 'pages',
      versions: true,
      fields: { title: defineField.text({ required: true }), body: defineField.text() }
    })
  ],
  adapters: { database: historyDb, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
});
historyRuntime.init();
await historyRuntime.syncSchema();
const page = await historyRuntime.create({ collection: 'pages', data: { title: 'v1', body: 'kept' } });
await historyRuntime.update({ collection: 'pages', id: String(page.id), data: { title: 'v2' } });
const [latestPageVersion] = await historyRuntime.listVersions({ collection: 'pages', documentId: String(page.id) });
if (
  latestPageVersion?.versionNumber !== 2 ||
  JSON.stringify(latestPageVersion.data) !== JSON.stringify({ title: 'v2', body: 'kept' })
) {
  throw new Error('Expected version 2 to be the full content snapshot of the updated page');
}
beforeBatch = () =>
  historyStore.create('_versions_pages', {
    id: 'competing',
    documentId: page.id,
    versionNumber: 3,
    data: '{}',
    createdAt: new Date().toISOString()
  });
let raceError: unknown;
try {
  await historyRuntime.update({ collection: 'pages', id: String(page.id), data: { title: 'lost' } });
} catch (error) {
  raceError = error;
}
if (
  !(raceError instanceof ConcurrentModificationError) ||
  raceError.status !== 409 ||
  raceError.code !== 'CONCURRENT_MODIFICATION' ||
  (await historyStore.findById('pages', String(page.id)))?.title !== 'v2'
) {
  throw new Error('Expected a lost version race to reject with ConcurrentModificationError and write nothing');
}

const loginResponse = await handleLogin(
  {
    request: new Request('https://forge.test/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
    }),
    env: {}
  },
  { runtime: authRuntime }
);
if (loginResponse.status !== 200) throw new Error('Expected login to succeed with 200');
const loginCookie = loginResponse.headers.get('set-cookie');
const sessionToken = /forge_session=([^;]+)/.exec(loginCookie ?? '')?.[1];
if (!sessionToken) throw new Error('Expected a session token from the login Set-Cookie header');

const meResponse = await handleMe(
  { request: new Request('https://forge.test/me', { headers: { cookie: \`forge_session=\${sessionToken}\` } }), env: {} },
  { runtime: authRuntime }
);
if (meResponse.status !== 200) throw new Error('Expected handleMe to authenticate from the cookie alone');

const crossSiteLogout = await handleLogout(
  {
    request: new Request('https://forge.test/logout', {
      method: 'POST',
      headers: { cookie: \`forge_session=\${sessionToken}\`, origin: 'https://evil.test' }
    }),
    env: {}
  },
  { runtime: authRuntime }
);
if (crossSiteLogout.status !== 403) {
  throw new Error('Expected a cross-site cookie-authenticated logout to be rejected by CSRF protection');
}

const sameSiteLogout = await handleLogout(
  {
    request: new Request('https://forge.test/logout', {
      method: 'POST',
      headers: { cookie: \`forge_session=\${sessionToken}\`, origin: 'https://forge.test' }
    }),
    env: {}
  },
  { runtime: authRuntime }
);
if (sameSiteLogout.status !== 204) throw new Error('Expected a same-origin logout to succeed with 204');

// Small-project readiness (spec 055): a defineUsersCollection() + a relation to it, through the
// packed public surface only — the exact "post.author -> users" shape a small real consumer uses.
const smallProjectDb = new InMemoryDatabaseAdapter();
const smallProjectAuth = new UsersCollectionAuthAdapter({ devMode: true }).init({
  userDatabase: smallProjectDb
});
const smallProjectPosts = defineCollection({
  slug: 'sp_posts',
  fields: {
    title: defineField.text({ required: true }),
    author: defineField.relation({ collection: 'users' })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor'
  }
});
const smallProjectRuntime = new ForgeCmsRuntime({
  collections: [defineUsersCollection(), smallProjectPosts],
  adapters: { database: smallProjectDb, auth: smallProjectAuth, storage: new InMemoryStorageAdapter() }
});
smallProjectRuntime.init();
await smallProjectRuntime.syncSchema();

const spAdmin = await smallProjectAuth.createUser({ email: 'admin@sp.test', password: 'password123' });
if (!spAdmin.ok) throw new Error('Expected the first small-project user to become admin');
const spEditor = await smallProjectAuth.createUser({
  email: 'editor@sp.test',
  password: 'password123',
  role: 'editor'
});
if (!spEditor.ok) throw new Error('Expected editor creation to succeed');
const spViewer = await smallProjectAuth.createUser({
  email: 'viewer@sp.test',
  password: 'password123',
  role: 'viewer'
});
if (!spViewer.ok) throw new Error('Expected viewer creation to succeed');

// Role boundary through the packed public surface: editor may write, viewer may not.
await smallProjectRuntime.create({
  collection: 'sp_posts',
  overrideAccess: false,
  user: spEditor.user,
  data: { title: 'By the editor', author: spAdmin.user.id }
});
let viewerDenied = false;
try {
  await smallProjectRuntime.create({
    collection: 'sp_posts',
    overrideAccess: false,
    user: spViewer.user,
    data: { title: 'Should be denied', author: spAdmin.user.id }
  });
} catch {
  viewerDenied = true;
}
if (!viewerDenied) throw new Error('Expected a viewer to be denied write access to sp_posts');

// Population must never leak passwordHash (or any other access.read: [] field) from the related
// document — a real bug found building spec 055's fixture, fixed in populateRecords. Nor may a
// readable parent grant visibility into an otherwise-unreadable target (spec 058 §4):
// defineUsersCollection()'s default access.read is \`user !== null\`, so an anonymous caller must not
// see the populated author at all, while an authenticated one does.
const spPopulatedAnonymous = await smallProjectRuntime.find({
  collection: 'sp_posts',
  overrideAccess: false,
  user: null,
  depth: 1
});
if (spPopulatedAnonymous.docs[0]?.author !== null) {
  throw new Error('Expected an anonymous caller to see a null author (users collection is not publicly readable)');
}

const spPopulated = await smallProjectRuntime.find({
  collection: 'sp_posts',
  overrideAccess: false,
  user: spEditor.user,
  depth: 1
});
// Cast past the static field type (relation fields are typed as string | string[] — depth: 1
// population is a runtime-only reshaping the typed API does not narrow at compile time).
const spAuthor = spPopulated.docs[0]?.author as unknown as
  | { email?: string; passwordHash?: string }
  | undefined;
if (!spAuthor || typeof spAuthor !== 'object') {
  throw new Error('Expected the author relation to populate into an object for an authenticated caller');
}
if ('passwordHash' in spAuthor) {
  throw new Error('passwordHash leaked through a populated relation');
}
if (spAuthor.email !== 'admin@sp.test') {
  throw new Error('Expected the populated author to still carry its readable fields');
}

console.log('runtime consumer ok');
`
  );

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: dir });
  run('node', ['dist/index.js'], { cwd: dir });
}

function verifyCloudflareConsumer(tarballs) {
  const dir = installConsumer('cloudflare-consumer', tarballs, ['typescript@5.9.2']);

  const srcDir = join(dir, 'src');
  run('mkdir', ['-p', srcDir]);
  writeBaseTsconfig(dir);
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { defineCollection, defineField } from '@forge-cms/core';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter, R2StorageAdapter, type D1Database, type R2Bucket } from '@forge-cms/cloudflare';

const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true })
  }
});

declare const DB: D1Database;
declare const BUCKET: R2Bucket;

const runtime = new ForgeCmsRuntime({
  collections: [notes],
  adapters: {
    database: new D1DatabaseAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new R2StorageAdapter()
  },
  env: { DB, BUCKET }
});

runtime.init();
`
  );

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], { cwd: dir });
}

// Spec 073: the upgrade/recovery runbook (docs/BACKUP-RESTORE.md, docs/SCHEMA-UPGRADES.md) may only
// use exports the packed packages really ship. Compiles that exact surface and runs one reviewed
// migration on an on-disk libSQL file — the historical-fixture rehearsal itself is
// `pnpm test:upgrade`, not this check.
function verifyUpgradeConsumer(tarballs) {
  const dir = installConsumer('upgrade-consumer', tarballs, ['typescript@5.9.2']);

  const srcDir = join(dir, 'src');
  run('mkdir', ['-p', srcDir]);
  writeBaseTsconfig(dir);
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { defineCollection, defineField } from '@forge-cms/core';
import {
  LibSqlDatabaseAdapter,
  defineMigration,
  formatSchemaPlan,
  isMigrationError,
  isSchemaDriftError
} from '@forge-cms/db';
import type { MigrationDefinition, MigrationRecord, SchemaPlan } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime, handleFile, reconcileStorage } from '@forge-cms/runtime';
import type { MigrationReport, ReconcileStorageReport } from '@forge-cms/runtime';

const url = 'file:./upgrade-check.db';

function runtimeFor(fields: Parameters<typeof defineCollection>[0]['fields']) {
  return new ForgeCmsRuntime({
    collections: [defineCollection({ slug: 'notes', fields })],
    adapters: {
      database: new LibSqlDatabaseAdapter(url),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  }).init();
}

const v1 = runtimeFor({ headline: defineField.text() });
await v1.syncSchema();
await v1.create({ collection: 'notes', data: { headline: 'Hello' } });

const v2 = runtimeFor({ title: defineField.text() });
const before: SchemaPlan = await v2.planSchema();
if (!before.blocking) throw new Error('Expected the rename to block the plan');
console.log(formatSchemaPlan(before));
try {
  await v2.syncSchema();
  throw new Error('syncSchema() must refuse a blocking plan');
} catch (err) {
  if (!isSchemaDriftError(err)) throw err;
}

const migrations: MigrationDefinition[] = [
  defineMigration({
    id: '001_notes_headline_to_title',
    description: 'Rename notes.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "notes" RENAME COLUMN "headline" TO "title"' }],
    resetBaseline: ['notes']
  })
];
console.table(await v2.planMigrations(migrations));
const report: MigrationReport = await v2.runMigrations(migrations, { allowDestructive: true });
if (report.after.blocking || report.results[0]?.outcome !== 'applied') {
  throw new Error('Expected the reviewed migration to apply and leave a clean plan');
}
const again: MigrationReport = await v2.runMigrations(migrations, { allowDestructive: true });
if (again.results[0]?.outcome !== 'already-applied') throw new Error('Expected already-applied');
const history: MigrationRecord[] = await v2.readMigrationHistory();
if (history.length !== 1 || history[0]?.status !== 'applied') throw new Error('Unexpected ledger');
const notes = await v2.find({ collection: 'notes' });
if (notes.docs[0]?.['title'] !== 'Hello') throw new Error('The renamed value did not survive');

const reconciled: ReconcileStorageReport = await v2.reconcileStorage();
void reconciled;
void reconcileStorage;
void handleFile;
void isMigrationError;
console.log('upgrade consumer ok');
`
  );

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: dir });
  run('node', ['dist/index.js'], { cwd: dir });
}

function verifyAngularConsumer(tarballs) {
  const dir = installConsumer('angular-consumer', tarballs, [
    '@angular/common@^21.2.10',
    '@angular/compiler@^21.2.10',
    '@angular/compiler-cli@^21.2.10',
    '@angular/core@^21.2.10',
    '@angular/forms@^21.2.10',
    '@angular/platform-browser@^21.2.10',
    '@angular/router@^21.2.10',
    '@voltui/components@^1.0.1',
    'lumen-icons@^0.2.0',
    'rxjs@^7.8.2',
    'typescript@5.9.2'
  ]);

  const srcDir = join(dir, 'src');
  run('mkdir', ['-p', srcDir]);
  writeBaseTsconfig(dir, {
    experimentalDecorators: true
  });
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { Component, inject } from '@angular/core';
import type { CanActivateFn, Routes } from '@angular/router';
import {
  CmsApiService,
  ForgeAuthSession,
  forgeAuthGuard,
  provideForgeCms,
  type QueryOptions
} from '@forge-cms/angular';
import {
  ForgeAdminLayoutComponent,
  ForgeCollectionListComponent,
  ForgeCollectionWorkspaceComponent,
  ForgeDocumentEditorComponent,
  ForgeCollectionsIndexComponent,
  ForgeConfirmDialogComponent,
  ForgeSignInComponent,
  ForgeSignUpComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes,
  type ForgeAdminConfig
} from '@forge-cms/admin';

// Embeddable content admin (spec 052): the content-CRUD orchestration layer's real, final public
// names, importable from the packed public entry only (no deep imports into src/), usable as
// Angular route \`component:\` values — the exact shape a host consumer's own routes file would use.
const contentRoutes: Routes = [
  { path: 'collections', component: ForgeCollectionsIndexComponent },
  { path: 'collections/:collection', component: ForgeCollectionWorkspaceComponent },
  { path: 'collections/:collection/new', component: ForgeDocumentEditorComponent }
];
void contentRoutes;
const generatedRoutes: Routes = forgeAdminContentRoutes();
void generatedRoutes;
void ForgeConfirmDialogComponent;

// Angular/admin auth experience (spec 054): a real consumer's route composition, through the packed
// public surface only — session, guard, sign-in/up, users workspace, and the auth route helper.
const authRoutes: Routes = [
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: '',
    canActivate: [forgeAuthGuard({ roles: ['admin'] })],
    children: [
      { path: 'users', component: ForgeUsersWorkspaceComponent },
      { path: 'login', component: ForgeSignInComponent },
      { path: 'signup', component: ForgeSignUpComponent }
    ]
  }
];
void authRoutes;
const guard: CanActivateFn = forgeAuthGuard();
void guard;

const providers = provideForgeCms({ baseUrl: '/api' });

// Query completeness (spec 050): nested and/or where + multi-field sort compile through the packed
// public \`QueryOptions\` type; findOne is a real method on the packed CmsApiService.
const queryOptions: QueryOptions = {
  where: { and: [{ status: 'published' }, { or: [{ featured: true }, { views: { gte: 100 } }] }] },
  sort: [{ field: 'featured', order: 'desc' }]
};
void queryOptions;
async function useFindOne(api: CmsApiService) {
  return api.findOne('posts', { slug: 'hello' });
}
void useFindOne;

const adminConfig: ForgeAdminConfig = {
  title: 'External ForgeCMS',
  nav: [],
  signInPath: '/login'
};

@Component({
  standalone: true,
  imports: [ForgeAdminLayoutComponent, ForgeCollectionListComponent],
  providers,
  template: '<forge-admin-layout [config]="adminConfig"></forge-admin-layout>'
})
export class ExternalAdminComponent {
  protected readonly adminConfig = adminConfig;
  protected readonly api = inject(CmsApiService);
  // Angular/admin auth experience (spec 054): the session service is a real injectable from the
  // packed public entry, with the real signal API a consumer would read in a template.
  protected readonly session = inject(ForgeAuthSession);
  protected readonly authenticated = this.session.authenticated;
  protected readonly currentUser = this.session.user;
}
`
  );

  run('pnpm', ['exec', 'ngc', '-p', 'tsconfig.json'], { cwd: dir });
}

// Spec 076 (roadmap C02): a typed Angular consumer built from the packed tarballs only. It declares
// exactly the two Forge packages it imports (core for the server-side model, angular for the browser),
// shares the model with the browser through `import type`, and proves (1) the typed client accepts valid
// CRUD/draft/global usage without casts, (2) invalid slugs, fields and values fail `tsc`, and (3) the
// compiled browser modules contain no server code.
function verifyTypedAngularConsumer(tarballs) {
  const forge = tarballs.filter((tarball) =>
    ['@forge-cms/core', '@forge-cms/angular'].includes(tarball.name)
  );
  const dir = installConsumer('typed-angular-consumer', forge, [
    '@angular/core@^21.2.10',
    '@angular/router@^21.2.10',
    'rxjs@^7.8.2',
    'typescript@5.9.2'
  ]);
  mkdirSync(join(dir, 'src', 'server'), { recursive: true });
  mkdirSync(join(dir, 'src', 'browser'), { recursive: true });
  writeBaseTsconfig(dir, { lib: ['ES2022', 'DOM'] });

  writeFileSync(
    join(dir, 'src', 'server', 'content.ts'),
    `import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';

const SECRET = 'SERVER_ONLY_SECRET_MARKER';

export const users = defineCollection({
  slug: 'users',
  fields: {
    email: defineField.email({ required: true }),
    passwordHash: defineField.text({ access: { read: [], write: [] } })
  },
  access: { read: ({ user }) => user !== null }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    publishedAt: defineField.date(),
    author: defineField.relation({ collection: 'users', required: true }),
    internalNote: defineField.textarea({ access: { read: ['admin'] } })
  },
  hooks: {
    beforeChange: [({ data }) => ({ ...data, signature: SECRET + 'SERVER_ONLY_HOOK_MARKER' })]
  }
});

export const settings = defineGlobal({
  slug: 'settings',
  fields: { siteName: defineField.text({ required: true }) }
});

export const collections = [users, posts];
`
  );

  writeFileSync(
    join(dir, 'src', 'browser', 'schema.ts'),
    `import type { ForgeSchema } from '@forge-cms/angular';
import type { collections, settings } from '../server/content.js';

export type SiteSchema = ForgeSchema<typeof collections, [typeof settings]>;
`
  );

  writeFileSync(
    join(dir, 'src', 'browser', 'client.ts'),
    `import {
  injectForgeClient,
  provideForgeCms,
  type CmsApiService,
  type ForgeDocument,
  type ForgeWriteReceipt
} from '@forge-cms/angular';
import type { SiteSchema } from './schema.js';

export const providers = provideForgeCms({ baseUrl: '/api/v1' });

type Post = ForgeDocument<SiteSchema, 'posts'>;
type User = ForgeDocument<SiteSchema, 'users'>;

/** Valid usage: no response generics, no casts. */
export async function useTypedClient(): Promise<string> {
  const cms = injectForgeClient<SiteSchema>();
  const posts: Post[] = await cms.getDocuments('posts', {
    where: { _status: 'published' },
    sort: [{ field: 'publishedAt', order: 'desc' }]
  });
  const date: string | null | undefined = posts[0]?.publishedAt;
  const populated = await cms.getDocument('posts', 'p1', { depth: 1 });
  const author: User | null = populated.author;
  const created: Post | ForgeWriteReceipt = await cms.createDocument('posts', {
    title: 'Hello',
    author: 'u1',
    publishedAt: new Date()
  });
  await cms.updateDocument('posts', created.id, { title: 'Renamed' });
  await cms.setDocumentStatus('posts', created.id, 'published');
  const settings = await cms.getGlobal('settings');
  return [date, author?.email, settings?.siteName].join(' ');
}

/** The untyped escape hatch still accepts anything. */
export async function useUntypedClient(api: CmsApiService): Promise<unknown> {
  const slug: string = 'anything';
  return (await api.getDocuments(slug, { where: { any: 1 } }))[0]?.['field'];
}

// Never invoked. Removing any @ts-expect-error here fails 'tsc -p tsconfig.json'.
export async function rejected(cms: CmsApiService<SiteSchema>): Promise<void> {
  // @ts-expect-error - unknown collection slug
  await cms.getDocuments('pages');
  // @ts-expect-error - unknown global slug
  await cms.getGlobal('footer');
  // @ts-expect-error - unknown where field
  await cms.getDocuments('posts', { where: { nope: true } });
  // @ts-expect-error - missing required author on create
  await cms.createDocument('posts', { title: 'x' });
  // @ts-expect-error - wrong value type on update
  await cms.updateDocument('posts', 'id', { title: 42 });
  // @ts-expect-error - Forge generates ids
  await cms.createDocument('posts', { title: 'x', author: 'u', id: 'mine' });
  const post = await cms.getDocument('posts', 'id');
  // @ts-expect-error - a date is a string on the wire
  post.publishedAt?.getTime();
  // @ts-expect-error - an access-controlled field is not guaranteed
  void post.internalNote.length;
  const populated = await cms.getDocument('posts', 'id', { depth: 1 });
  // @ts-expect-error - a populated single relation may be null
  void populated.author.email;
  // @ts-expect-error - never-readable fields are not in the type
  void populated.author?.passwordHash;
}
`
  );

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: dir });

  // The browser modules compiled to JavaScript without the server module or any core import.
  for (const file of ['client.js', 'schema.js']) {
    const output = readFileSync(join(dir, 'dist', 'browser', file), 'utf8');
    for (const forbidden of [
      'server/content',
      '@forge-cms/core',
      'SERVER_ONLY_HOOK_MARKER',
      'SERVER_ONLY_SECRET_MARKER'
    ]) {
      if (output.includes(forbidden)) {
        fail(`typed Angular consumer: dist/browser/${file} contains '${forbidden}'`);
      }
    }
  }
  console.log('typed angular consumer ok');
}

try {
  run('mkdir', ['-p', packDir]);

  const tarballs = [];
  for (const packageName of publicPackages) {
    run('pnpm', ['--filter', packageName, 'pack', '--pack-destination', packDir]);
    const expectedPrefix = `${sanitizePackageName(packageName)}-`;
    const packed = readdirSync(packDir)
      .filter((file) => file.startsWith(expectedPrefix) && file.endsWith('.tgz'))
      .map((file) => join(packDir, file))
      .sort()
      .at(-1);

    if (!packed) fail(`Could not find tarball for ${packageName}`);
    tarballs.push({ name: packageName, path: packed });
  }

  // Public packages are versioned together via Changesets' `fixed` group (.changeset/config.json),
  // so every packed tarball must carry the exact same version as every other one — not a specific
  // hardcoded number, which would only ever match the very first release and break every release
  // after it (see the 0.0.1 -> 0.0.2 CI failure this replaced).
  let expectedVersion;

  for (const tarball of tarballs) {
    const extractDir = join(workDir, `extract-${tarballs.indexOf(tarball)}`);
    run('mkdir', ['-p', extractDir]);
    run('tar', ['-xzf', tarball.path, '-C', extractDir]);

    const packageDir = join(extractDir, 'package');
    const pkg = readJson(join(packageDir, 'package.json'));
    if (!publicPackages.includes(pkg.name)) fail(`Unexpected packed package ${pkg.name}`);

    if (expectedVersion === undefined) {
      expectedVersion = pkg.version;
    } else if (pkg.version !== expectedVersion) {
      fail(
        `${pkg.name} packed version is ${pkg.version}, but ${tarballs[0].name} is ${expectedVersion} — ` +
          'the fixed public package group has diverged.'
      );
    }

    assertNoWorkspaceProtocols(pkg, pkg.name);
    assertPackedContents(pkg, listFiles(packageDir), packageDir);
  }

  verifyRuntimeConsumer(tarballs);
  verifyCloudflareConsumer(tarballs);
  verifyUpgradeConsumer(tarballs);
  verifyAngularConsumer(tarballs);
  verifyTypedAngularConsumer(tarballs);

  console.log('Release verification passed.');
} finally {
  if (process.env.FORGE_CMS_KEEP_RELEASE_TMP === '1') {
    console.log(`Keeping temporary release directory: ${workDir}`);
  } else {
    rmSync(workDir, { recursive: true, force: true });
  }
}
