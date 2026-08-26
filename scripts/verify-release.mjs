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

function dependencySections(pkg) {
  return [
    pkg.dependencies ?? {},
    pkg.peerDependencies ?? {},
    pkg.optionalDependencies ?? {},
    pkg.devDependencies ?? {}
  ];
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
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime, UniqueConstraintError } from '@forge-cms/runtime';

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

const runtime = new ForgeCmsRuntime({
  collections: [notes],
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
import { CmsApiService, provideForgeCms } from '@forge-cms/angular';
import {
  ForgeAdminLayoutComponent,
  ForgeCollectionListComponent,
  type ForgeAdminConfig
} from '@forge-cms/admin';

const providers = provideForgeCms({ baseUrl: '/api' });

const adminConfig: ForgeAdminConfig = {
  title: 'External ForgeCMS',
  nav: []
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

  for (const tarball of tarballs) {
    const extractDir = join(workDir, `extract-${tarballs.indexOf(tarball)}`);
    run('mkdir', ['-p', extractDir]);
    run('tar', ['-xzf', tarball.path, '-C', extractDir]);

    const packageDir = join(extractDir, 'package');
    const pkg = readJson(join(packageDir, 'package.json'));
    if (!publicPackages.includes(pkg.name)) fail(`Unexpected packed package ${pkg.name}`);
    if (pkg.version !== '0.0.1')
      fail(`${pkg.name} packed version is ${pkg.version}, expected 0.0.1`);

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
