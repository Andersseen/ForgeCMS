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
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
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
  ForgeCmsRuntime,
  UniqueConstraintError,
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
const queryRuntime = new ForgeCmsRuntime({
  collections: [
    defineCollection({
      slug: 'articles2',
      fields: {
        title: defineField.text({ required: true }),
        category: defineField.text(),
        status: defineField.text(),
        featured: defineField.boolean(),
        views: defineField.number(),
        tags: defineField.relation({ collection: 'tags', many: true })
      }
    })
  ],
  adapters: { database: queryDb, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
});
queryRuntime.init();
await queryRuntime.syncSchema();

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

function verifyAngularConsumer(tarballs) {
  const dir = installConsumer('angular-consumer', tarballs, [
    '@angular/common@^21.2.10',
    '@angular/compiler@^21.2.10',
    '@angular/compiler-cli@^21.2.10',
    '@angular/core@^21.2.10',
    '@angular/forms@^21.2.10',
    '@angular/platform-browser@^21.2.10',
    '@angular/router@^21.2.10',
    '@voltui/components@^0.6.0',
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
  verifyAngularConsumer(tarballs);

  console.log('Release verification passed.');
} finally {
  if (process.env.FORGE_CMS_KEEP_RELEASE_TMP === '1') {
    console.log(`Keeping temporary release directory: ${workDir}`);
  } else {
    rmSync(workDir, { recursive: true, force: true });
  }
}
