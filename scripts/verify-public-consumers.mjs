// Packed public-package consumers — roadmap 0.12 / R01, spec 088. `pnpm release:consumers`.
//
// Two clean temporary projects that install ONLY the packed candidate tarballs (strict peers, no automatic peer
// installation, no workspace/alias/private-source shortcuts):
//
//   server-only  core · db · auth · storage · api · runtime and nothing else. Proves the backend does not drag
//                Angular, the admin, VoltUI, CDK or lumen into a server project, then compiles under strict
//                TypeScript and RUNS a first-admin + CRUD + access (`overrideAccess: false`) + relation journey.
//   entrypoints  all eleven packages together with their real peers. Resolves every package root and the four
//                retained subpaths through the exports maps, type-checks every symbol of the committed
//                api-baseline against the packed declarations, imports the server-safe entries in Node, and
//                scans the packed JavaScript of the browser-facing packages for server/Node leakage.
//
// The tarballs come from the certified artifact set (`FORGE_CERT_ARTIFACTS`) or are packed once here.
// FORGE_CMS_KEEP_SSR_TMP=1 keeps the temporary projects.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PUBLIC_PACKAGES,
  RETAINED_SUBPATHS,
  assertCleanConsumer,
  resolveTarballs
} from './certification/artifacts.mjs';
import { NPMRC, VERSIONS, ng } from './ssr-consumer/shared.mjs';

const repoRoot = process.cwd();
const keep = process.env.FORGE_CMS_KEEP_SSR_TMP === '1';

function run(command, args, cwd, env = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, CI: 'true', ...env }
    });
  } catch (err) {
    // Show the tool's own output (tsc writes diagnostics to stdout), not Node's wrapped dump.
    process.stdout.write(String(err.stdout ?? ''));
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function fail(message) {
  throw new Error(message);
}

function writeProject(dir, { name, tarballs, dependencies, devDependencies, files }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { ...tarballs, ...dependencies },
        devDependencies,
        // Forge's internal dependencies must resolve to the tarballs as well.
        pnpm: { overrides: tarballs }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(dir, '.npmrc'), NPMRC);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
}

const TSCONFIG = (include) =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', 'DOM'],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        outDir: 'dist',
        types: ['node']
      },
      include
    },
    null,
    2
  )}\n`;

// ---------------------------------------------------------------------------------------------------------
// 1. Server-only consumer

const SERVER_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime'
];

/** Store entries a server-only project must never contain. */
const FRONTEND_ENTRIES = [
  /^@angular\+/,
  /^@voltui\+/,
  /^lumen-icons@/,
  /^rxjs@/,
  /^zone\.js@/,
  /^@forge-cms\+angular@/,
  /^@forge-cms\+admin@/
];

const SERVER_INDEX = `import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';

const users = defineUsersCollection();
const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin',
    update: ({ user }) => user?.role === 'admin',
    delete: ({ user }) => user?.role === 'admin'
  }
});

const database = new InMemoryDatabaseAdapter();
const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
const runtime = new ForgeCmsRuntime({
  collections: [users, posts],
  adapters: { database, auth, storage: new InMemoryStorageAdapter() }
});
runtime.init();
await runtime.syncSchema();

// First admin through the supported auth adapter: the very first user is always the administrator.
const created = await auth.createUser({ email: 'admin@example.test', password: 'correct horse battery' });
if (!created.ok) throw new Error('first admin was not created: ' + created.reason);
const login = await auth.login('admin@example.test', 'correct horse battery');
if (!login.ok) throw new Error('first admin cannot sign in');
const admin = await auth.requireAuth(
  new Request('https://forge.test/api', { headers: { authorization: 'Bearer ' + login.token } })
);
if (admin.role !== 'admin') throw new Error('the first user is not an admin: ' + admin.role);

// A second, unprivileged user.
const second = await auth.createUser({ email: 'viewer@example.test', password: 'another long password', role: 'viewer' });
if (!second.ok) throw new Error('second user was not created');
const viewerLogin = await auth.login('viewer@example.test', 'another long password');
if (!viewerLogin.ok) throw new Error('second user cannot sign in');
const viewer = await auth.requireAuth(
  new Request('https://forge.test/api', { headers: { authorization: 'Bearer ' + viewerLogin.token } })
);

// Representative CRUD through the Local API with access enforced.
const post = await runtime.create({
  collection: 'posts',
  data: { title: 'Hello', author: admin.id },
  user: admin,
  overrideAccess: false
});
const updated = await runtime.update({
  collection: 'posts',
  id: String(post.id),
  data: { title: 'Hello again' },
  user: admin,
  overrideAccess: false
});
if (updated.title !== 'Hello again') throw new Error('update did not persist');

// A relation is read safely: populated for a reader, and never carries credential material.
const populated = await runtime.findByID({
  collection: 'posts',
  id: String(post.id),
  depth: 1,
  user: viewer,
  overrideAccess: false
});
const serialized = JSON.stringify(populated);
for (const secret of ['passwordHash', '_sessionVersion', 'correct horse battery']) {
  if (serialized.includes(secret)) throw new Error('populated relation leaked ' + secret);
}

// Unauthorized writes are denied, anonymous and unprivileged alike.
async function denied(label: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return;
    throw new Error(label + ' failed with an unexpected error: ' + String(error));
  }
  throw new Error(label + ' was not denied');
}
await denied('anonymous create', () =>
  runtime.create({ collection: 'posts', data: { title: 'x', author: admin.id }, user: null, overrideAccess: false })
);
await denied('viewer create', () =>
  runtime.create({ collection: 'posts', data: { title: 'x', author: admin.id }, user: viewer, overrideAccess: false })
);
await denied('viewer delete', () =>
  runtime.delete({ collection: 'posts', id: String(post.id), user: viewer, overrideAccess: false })
);

await runtime.delete({ collection: 'posts', id: String(post.id), user: admin, overrideAccess: false });
const remaining = await runtime.find({ collection: 'posts', user: admin, overrideAccess: false });
if (remaining.docs.length !== 0) throw new Error('delete did not persist');

console.log('server-only consumer journey ok');
`;

function verifyServerOnly(workDir, allTarballs) {
  const dir = join(workDir, 'server-only');
  const tarballs = Object.fromEntries(
    SERVER_PACKAGES.map((name) => [name, allTarballs[name] ?? fail(`no tarball for ${name}`)])
  );
  writeProject(dir, {
    name: 'forge-server-only-consumer',
    tarballs,
    dependencies: {},
    devDependencies: { typescript: VERSIONS.typescript, '@types/node': '22.15.3' },
    files: { 'src/index.ts': SERVER_INDEX, 'tsconfig.json': TSCONFIG(['src/**/*.ts']) }
  });
  assertCleanConsumer(dir, 'server-only consumer');
  run('pnpm', ['install', '--prefer-offline'], dir);

  const store = readdirSync(join(dir, 'node_modules', '.pnpm'));
  const frontend = store.filter((entry) => FRONTEND_ENTRIES.some((pattern) => pattern.test(entry)));
  if (frontend.length > 0) fail(`the server-only project installed frontend packages: ${frontend}`);

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], dir);
  const output = run('node', ['dist/index.js'], dir);
  process.stdout.write(output);
  if (!output.includes('server-only consumer journey ok'))
    fail('server-only journey did not finish');
  console.log(
    '  ✓ server-only consumer: no Angular/admin installed, strict tsc, built Node output ran'
  );
}

// ---------------------------------------------------------------------------------------------------------
// 2. Entry points (roots + retained subpaths)

const specifierFile = (specifier) =>
  `_forge-cms_${specifier.slice('@forge-cms/'.length).replaceAll('/', '_')}.json`;

/** One module per entry point (names collide across packages): `import type { … }` from the committed api baseline. */
function symbolImports() {
  const specifiers = [...PUBLIC_PACKAGES, ...RETAINED_SUBPATHS];
  const files = {};
  for (const specifier of specifiers) {
    const names = JSON.parse(
      readFileSync(join(repoRoot, 'api-baseline', specifierFile(specifier)), 'utf8')
    );
    if (!Array.isArray(names) || names.length === 0) fail(`empty api baseline for ${specifier}`);
    files[`src/${specifier.replace('@forge-cms/', '').replaceAll('/', '-')}.ts`] =
      `import type { ${names.join(', ')} } from '${specifier}';\nexport {};\n`;
  }
  return { specifiers, files };
}

/** Entries that load in plain Node (no Angular/DOM): imported for real. The rest are resolved only. */
const NODE_IMPORTABLE = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/s3',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/testing',
  '@forge-cms/testing/contracts',
  '@forge-cms/angular/vite',
  '@forge-cms/admin/vite'
];

const RESOLVE_SCRIPT = (specifiers) => `const failures = [];
for (const specifier of ${JSON.stringify(specifiers)}) {
  try {
    const url = import.meta.resolve(specifier);
    if (!url.includes('/node_modules/') || url.includes('/src/')) failures.push(specifier + ' -> ' + url);
  } catch (error) {
    failures.push(specifier + ': ' + error.message);
  }
}
for (const specifier of ${JSON.stringify(NODE_IMPORTABLE)}) {
  try {
    const mod = await import(specifier);
    if (Object.keys(mod).length === 0) failures.push(specifier + ' exports nothing at runtime');
  } catch (error) {
    failures.push(specifier + ' failed to import: ' + error.message);
  }
}
if (failures.length > 0) {
  console.error(failures.join('\\n'));
  process.exit(1);
}
console.log('entry points ok');
`;

/** Node/server-only things the packed JavaScript of a browser-facing package must never import. */
const SERVER_ONLY_IMPORT =
  /(?:from\s+|import\s*\()\s*['"](node:[^'"]+|@forge-cms\/(?:db|auth|runtime|s3|cloudflare|storage|api|testing)(?:\/[^'"]*)?|@libsql\/[^'"]+|@aws-sdk\/[^'"]+|h3|nitropack)['"]/;

function jsFilesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(dir, file));
}

/** Good enough to ignore doc prose: block comments and whole-line `//` comments. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function verifyBrowserBoundary(consumerDir) {
  for (const name of ['@forge-cms/angular', '@forge-cms/admin']) {
    const dist = join(consumerDir, 'node_modules', name, 'dist');
    for (const file of jsFilesUnder(dist)) {
      const relative = file.slice(dist.length + 1);
      // `@forge-cms/angular/server` is the one intentionally server-side entry.
      if (name === '@forge-cms/angular' && /^server(?:[./-]|$)/.test(relative)) continue;
      const source = readFileSync(file, 'utf8');
      const match = SERVER_ONLY_IMPORT.exec(source);
      if (match) fail(`${name} dist/${relative} imports ${match[1]}, which is server-only`);
      // Spec 087: transport defaults live in @forge-cms/angular; admin code never embeds them.
      if (name === '@forge-cms/admin' && /['"`]\/api\/(?:v1|auth)/.test(stripComments(source))) {
        fail(`${name} dist/${relative} embeds an /api/v1 or /api/auth deployment assumption`);
      }
      if (/packages\/[a-z-]+\/src/.test(source)) {
        fail(`${name} dist/${relative} references a repository packages/*/src path`);
      }
    }
  }
  console.log(
    '  ✓ browser boundary: angular (minus /server) and admin import no server/Node/private code'
  );
}

function verifyEntryPoints(workDir, tarballs) {
  const dir = join(workDir, 'entrypoints');
  const { specifiers, files: symbolFiles } = symbolImports();
  writeProject(dir, {
    name: 'forge-entrypoints-consumer',
    tarballs,
    dependencies: {
      ...Object.fromEntries(
        ['compiler', 'core', 'common', 'forms', 'platform-browser', 'router']
          .map((pkg) => ng(pkg))
          .map(([name, version]) => [name, version])
      ),
      '@angular/cdk': VERSIONS.cdk,
      '@angular/compiler-cli': VERSIONS.angular,
      '@angular/platform-server': VERSIONS.angular,
      '@babel/core': VERSIONS.babel,
      '@voltui/components': VERSIONS.voltui,
      'lumen-icons': VERSIONS.lumenIcons,
      rxjs: VERSIONS.rxjs,
      vite: VERSIONS.vite,
      vitest: '4.0.0'
    },
    devDependencies: { typescript: VERSIONS.typescript, '@types/node': '22.15.3' },
    files: {
      ...symbolFiles,
      'resolve.mjs': RESOLVE_SCRIPT(specifiers),
      'tsconfig.json': TSCONFIG(['src/**/*.ts'])
    }
  });
  assertCleanConsumer(dir, 'entrypoints consumer');
  run('pnpm', ['install', '--prefer-offline'], dir);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], dir);
  process.stdout.write(run('node', ['resolve.mjs'], dir));
  verifyBrowserBoundary(dir);
  console.log(
    `  ✓ entry points: ${specifiers.length} specifiers (11 roots + ${RETAINED_SUBPATHS.length} subpaths) resolve, type-check every baseline symbol, and the Node-safe ones import`
  );
}

// ---------------------------------------------------------------------------------------------------------

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-consumers-'));
try {
  const tarballs = resolveTarballs(join(workDir, 'packs'), PUBLIC_PACKAGES, {
    log: (line) => console.log(line)
  });
  verifyServerOnly(workDir, tarballs);
  verifyEntryPoints(workDir, tarballs);
  console.log('\nPacked public-package consumers passed.');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
