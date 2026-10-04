// Strict packed-consumer compatibility matrix for `@forge-cms/angular` and `@forge-cms/admin`
// (spec 077, roadmap C03). `pnpm release:compat` after `pnpm build`.
//
// Every combination is an external Vite + `@analogjs/vite-plugin-angular` app that installs Forge only
// from packed tarballs, with strict peers and no automatic peer installation, so an unmet or invalid
// peer fails the install instead of silently adding a second Angular. Then: one physical copy of each
// Angular package / rxjs, `tsc`, `ngc` with strict templates, a production `vite build`, and bundle
// checks (everything linked, one `getBaseHrefFromDOM`, no server code).
//
// Usage: node scripts/verify-angular-compat.mjs [combination-id …]
// FORGE_CMS_KEEP_COMPAT_TMP=1 keeps the temporary apps for inspection.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SINGLETON_PACKAGES,
  countMethodDefinitions,
  countUnlinkedDeclarations,
  findDivergentResolutions,
  findDuplicateStoreEntries,
  locatePackage
} from './angular-compat.mjs';

/**
 * The matrix: the boundaries of every advertised peer range, plus the repository's own versions.
 * A value ending in a range (`^…`, `~…`, `>=…`) is resolved to the newest published match at run time.
 * Admin is limited to `@angular/* ^21.2.0` by its `@voltui/components` peer (VoltUI 1.x peers
 * `@angular/* ^21.2.0`), so the `angular-*` combinations install `@forge-cms/angular` alone.
 */
export const COMBINATIONS = [
  {
    id: 'angular-min',
    description: 'lowest Angular for @forge-cms/angular',
    admin: false,
    angular: '21.0.0',
    typescript: '5.9.2',
    rxjs: '7.8.0',
    vite: '7.0.0',
    vitePluginAngular: '2.4.8',
    babel: '7.28.0'
  },
  {
    id: 'admin-min',
    description: 'lowest versions of every @forge-cms/admin peer',
    admin: true,
    angular: '21.2.0',
    typescript: '5.9.2',
    rxjs: '7.8.0',
    vite: '7.0.0',
    vitePluginAngular: '2.4.8',
    babel: '7.28.0',
    cdk: '21.2.0',
    voltui: '1.0.1',
    lumenIcons: '0.2.0'
  },
  {
    id: 'current',
    description: 'the versions the first-party apps use',
    admin: true,
    angular: '21.2.10',
    typescript: '5.9.2',
    rxjs: '7.8.2',
    vite: '7.1.4',
    vitePluginAngular: '2.4.8',
    babel: '7.29.0',
    cdk: '21.2.10',
    voltui: '1.1.0',
    lumenIcons: '0.2.0'
  },
  {
    id: 'latest-21',
    description: 'newest published version inside every admin range',
    admin: true,
    angular: '^21.2.0',
    typescript: '~5.9.2',
    rxjs: '^7.8.0',
    vite: '^8.0.0',
    vitePluginAngular: '^2.4.8',
    babel: '^7.28.0',
    cdk: '^21.2.0',
    voltui: '^1.0.1',
    lumenIcons: '^0.2.0'
  },
  {
    id: 'angular-22',
    description: 'newest Angular 22 for @forge-cms/angular',
    admin: false,
    angular: '^22.0.0',
    typescript: '~6.0.0',
    rxjs: '^7.8.0',
    vite: '^8.0.0',
    vitePluginAngular: '^2.8.0',
    // Angular 22's linker requires Babel 8.
    babel: '^8.0.0'
  }
];

const repoRoot = process.cwd();
const keep = process.env.FORGE_CMS_KEEP_COMPAT_TMP === '1';

function run(command, args, cwd) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

function capture(command, args, cwd = repoRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' }
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  throw new Error(message);
}

const resolved = new Map();

/** An exact version stays as is; a range becomes the newest published version that satisfies it. */
function resolveVersion(name, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const key = `${name}@${spec}`;
  if (!resolved.has(key)) {
    const output = JSON.parse(capture('npm', ['view', key, 'version', '--json']));
    const versions = (Array.isArray(output) ? output : [output]).filter((v) => !v.includes('-'));
    const latest = versions.at(-1);
    if (latest === undefined) fail(`no published version of ${key}`);
    resolved.set(key, latest);
  }
  return resolved.get(key);
}

function pack(dir) {
  mkdirSync(dir, { recursive: true });
  const tarballs = {};
  for (const name of ['@forge-cms/core', '@forge-cms/angular', '@forge-cms/admin']) {
    run('pnpm', ['--filter', name, 'pack', '--pack-destination', dir], repoRoot);
    const prefix = `${name.replace('@', '').replace('/', '-')}-`;
    const file = readdirSync(dir).find(
      (entry) => entry.startsWith(prefix) && entry.endsWith('.tgz')
    );
    if (!file) fail(`could not find the tarball of ${name}`);
    tarballs[name] = `file:${join(dir, file)}`;
  }
  return tarballs;
}

function isPublished(name, version) {
  try {
    return capture('npm', ['view', `${name}@${version}`, 'version']).trim() === version;
  } catch {
    return false;
  }
}

/**
 * `@angular/build` is released on its own patch line: the framework version when it exists, else the
 * newest patch of the same minor.
 */
function buildVersion(angular) {
  if (isPublished('@angular/build', angular)) return angular;
  const [major, minor] = angular.split('.');
  return resolveVersion('@angular/build', `~${major}.${minor}.0`);
}

function manifest(combination, tarballs) {
  const angular = resolveVersion('@angular/core', combination.angular);
  const ng = (name) => [`@angular/${name}`, angular];
  const forge = {
    '@forge-cms/core': tarballs['@forge-cms/core'],
    '@forge-cms/angular': tarballs['@forge-cms/angular'],
    ...(combination.admin && { '@forge-cms/admin': tarballs['@forge-cms/admin'] })
  };
  const dependencies = {
    ...forge,
    ...Object.fromEntries(['common', 'compiler', 'core', 'platform-browser', 'router'].map(ng)),
    ...(combination.admin && {
      ...Object.fromEntries([ng('forms')]),
      // Not a Forge peer: VoltUI's own dependency (ng-primitives) requires it.
      '@angular/cdk': resolveVersion('@angular/cdk', combination.cdk),
      '@voltui/components': resolveVersion('@voltui/components', combination.voltui),
      'lumen-icons': resolveVersion('lumen-icons', combination.lumenIcons)
    }),
    rxjs: resolveVersion('rxjs', combination.rxjs),
    tslib: '^2.3.0'
  };
  const devDependencies = {
    '@analogjs/vite-plugin-angular': resolveVersion(
      '@analogjs/vite-plugin-angular',
      combination.vitePluginAngular
    ),
    '@angular/build': buildVersion(angular),
    '@angular/compiler-cli': angular,
    typescript: resolveVersion('typescript', combination.typescript),
    vite: resolveVersion('vite', combination.vite),
    '@babel/core': resolveVersion('@babel/core', combination.babel),
    // Not Forge peers: the WebAssembly fallback of @angular/build's bundler (rolldown →
    // @napi-rs/wasm-runtime) leaves them unmet, which a strict install would otherwise report.
    '@emnapi/core': '^1.7.1',
    '@emnapi/runtime': '^1.7.1'
  };
  return {
    name: `forge-compat-${combination.id}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies,
    devDependencies,
    // Forge's internal dependency (`admin` → `angular` → `core`) must resolve to the tarballs too.
    pnpm: { overrides: forge }
  };
}

const CONTENT = `import { defineCollection, defineField } from '@forge-cms/core';

const SECRET = 'SERVER_ONLY_SECRET_MARKER';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    publishedAt: defineField.date(),
    internalNote: defineField.textarea({ access: { read: ['admin'] } })
  },
  hooks: { beforeChange: [({ data }) => ({ ...data, signature: SECRET })] }
});

export const collections = [posts];
`;

const POSTS_COMPONENT = `import { Component, signal } from '@angular/core';
import {
  collectionResource,
  documentResource,
  injectForgeClient,
  type CmsApiService,
  type ForgeSchema
} from '@forge-cms/angular';
import type { collections } from './content';

export type Schema = ForgeSchema<typeof collections>;

@Component({
  selector: 'app-posts',
  template: \`
    @if (posts.error(); as error) {
      <p role="alert">{{ error.message }}</p>
    }
    @for (post of posts.value()?.docs ?? []; track post.id) {
      <h2>{{ post.title.toUpperCase() }}</h2>
      <time>{{ post.publishedAt ?? '—' }}</time>
    }
    <p>{{ first.isLoading() ? '…' : first.value()?.title }}</p>
    <button type="button" (click)="page.set(page() + 1)">Next</button>
  \`
})
export class PostsComponent {
  readonly page = signal(1);
  readonly posts = collectionResource<Schema, 'posts'>(() => ({
    collection: 'posts',
    where: { _status: 'published' },
    sort: [{ field: 'publishedAt', order: 'desc' }],
    limit: 10,
    page: this.page()
  }));
  readonly first = documentResource<Schema, 'posts'>(() => ({ collection: 'posts', id: 'p1' }));
  private readonly cms = injectForgeClient<Schema>();

  async publish(): Promise<void> {
    const created = await this.cms.createDocument('posts', { title: 'Hello', publishedAt: new Date() });
    await this.cms.setDocumentStatus('posts', created.id, 'published');
  }
}

// Never invoked. Removing any @ts-expect-error here fails tsc.
export async function rejected(cms: CmsApiService<Schema>): Promise<void> {
  // @ts-expect-error - unknown collection slug
  await cms.getDocuments('pages');
  // @ts-expect-error - unknown where field
  await cms.getDocuments('posts', { where: { nope: true } });
  // @ts-expect-error - missing required title
  await cms.createDocument('posts', {});
  const post = await cms.getDocument('posts', 'id');
  // @ts-expect-error - a date is an ISO string on the wire
  post.publishedAt?.getTime();
  // @ts-expect-error - an access-controlled field is not guaranteed
  void post.internalNote.length;
  // @ts-expect-error - a resource request's collection must be the resource's slug
  collectionResource<Schema, 'posts'>(() => ({ collection: 'pages' }));
}
`;

function appFiles(combination) {
  const adminImports = combination.admin
    ? `import {
  ForgeAdminLayoutComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes,
  type ForgeAdminConfig
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';
`
    : '';
  const adminShell = combination.admin
    ? `
@Component({
  selector: 'app-admin',
  imports: [ForgeAdminLayoutComponent, RouterOutlet],
  template: '<forge-admin-layout [config]="config"><router-outlet /></forge-admin-layout>'
})
export class AdminShellComponent {
  protected readonly config: ForgeAdminConfig = { title: 'Compat', nav: [], signInPath: '/admin/login' };
}
`
    : '';
  const adminRoutes = combination.admin
    ? `
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: 'admin',
    component: AdminShellComponent,
    canActivate: [forgeAuthGuard({ roles: ['admin', 'editor'] })],
    children: forgeAdminContentRoutes()
  },`
    : '';

  return {
    'index.html': `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Forge compat</title><base href="/" /></head>
  <body><app-root></app-root><script type="module" src="/src/main.ts"></script></body>
</html>
`,
    'src/content.ts': CONTENT,
    'src/posts.component.ts': POSTS_COMPONENT,
    'src/main.ts': `import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { RouterOutlet, provideRouter, type Routes } from '@angular/router';
import { ForgeAuthSession, provideForgeCms } from '@forge-cms/angular';
${adminImports}import { PostsComponent } from './posts.component';
${adminShell}
const routes: Routes = [${adminRoutes}
  { path: '', component: PostsComponent }
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<p>{{ session.status() }}</p><router-outlet />'
})
export class AppComponent {
  protected readonly session = inject(ForgeAuthSession);
}

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideRouter(routes), provideForgeCms()]
}).catch((error: unknown) => console.error(error));
`.replace(
      "import { Component, provideZonelessChangeDetection } from '@angular/core';",
      "import { Component, inject, provideZonelessChangeDetection } from '@angular/core';"
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          lib: ['ES2022', 'DOM'],
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          useDefineForClassFields: false,
          rootDir: 'src',
          outDir: 'out-tsc'
        },
        angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
        files: ['src/main.ts']
      },
      null,
      2
    ),
    'vite.config.mjs': `import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vite';
import { angularLinker } from '${combination.admin ? '@forge-cms/admin/vite' : '@forge-cms/angular/vite'}';

export default defineConfig({
  plugins: [angularLinker(), angular({ tsconfig: 'tsconfig.json' })],
  build: { target: 'es2022' }
});
`,
    // Strict: an unmet or invalid peer fails the install; nothing is installed to hide it.
    '.npmrc': 'strict-peer-dependencies=true\nauto-install-peers=false\n'
  };
}

function checkSingleCopies(dir, combination) {
  const store = join(dir, 'node_modules', '.pnpm');
  const duplicates = findDuplicateStoreEntries(readdirSync(store));
  if (duplicates.length > 0) {
    fail(
      `${combination.id}: more than one copy installed — ${duplicates
        .map(({ name, entries }) => `${name}: ${entries.join(', ')}`)
        .join('; ')}`
    );
  }

  const importers = { app: dir };
  for (const name of ['@forge-cms/angular', '@forge-cms/admin', '@voltui/components']) {
    const location = locatePackage(dir, name);
    if (location !== null) importers[name] = location;
  }
  const resolutions = Object.fromEntries(
    Object.entries(importers).map(([label, from]) => [
      label,
      Object.fromEntries(SINGLETON_PACKAGES.map((name) => [name, locatePackage(from, name)]))
    ])
  );
  const divergent = findDivergentResolutions(resolutions);
  if (divergent.length > 0) {
    fail(`${combination.id}: packages resolve to different copies — ${JSON.stringify(divergent)}`);
  }
  console.log(
    `  ✓ one copy of ${SINGLETON_PACKAGES.join(', ')} for ${Object.keys(importers).join(', ')}`
  );
}

function checkBundle(dir, combination) {
  const assets = join(dir, 'dist', 'assets');
  const code = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(assets, file), 'utf8'))
    .join('\n');
  const unlinked = countUnlinkedDeclarations(code);
  if (unlinked > 0)
    fail(`${combination.id}: ${unlinked} unlinked partial declarations in the bundle`);
  const definitions = countMethodDefinitions(code, 'getBaseHrefFromDOM');
  if (definitions !== 1) {
    fail(`${combination.id}: expected one getBaseHrefFromDOM definition, found ${definitions}`);
  }
  for (const marker of ['SERVER_ONLY_SECRET_MARKER', 'defineCollection']) {
    if (code.includes(marker)) fail(`${combination.id}: the browser bundle contains '${marker}'`);
  }
  console.log('  ✓ bundle: fully linked, one getBaseHrefFromDOM, no server code');
}

function installedVersions(dir, combination) {
  const names = [
    '@angular/core',
    '@angular/build',
    'typescript',
    'rxjs',
    'vite',
    '@analogjs/vite-plugin-angular',
    '@babel/core',
    ...(combination.admin ? ['@voltui/components', 'lumen-icons'] : [])
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version
    ])
  );
}

function verify(combination, tarballs, workDir) {
  console.log(`\n=== ${combination.id} — ${combination.description}`);
  const dir = join(workDir, combination.id);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeJson(join(dir, 'package.json'), manifest(combination, tarballs));
  for (const [file, content] of Object.entries(appFiles(combination))) {
    writeFileSync(join(dir, file), content);
  }

  run('pnpm', ['install', '--prefer-offline'], dir);
  checkSingleCopies(dir, combination);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], dir);
  run('pnpm', ['exec', 'ngc', '-p', 'tsconfig.json'], dir);
  run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], dir);
  if (!existsSync(join(dir, 'dist', 'index.html'))) fail(`${combination.id}: no dist/index.html`);
  checkBundle(dir, combination);
  return installedVersions(dir, combination);
}

const selected = process.argv.slice(2);
const combinations = selected.length
  ? COMBINATIONS.filter(({ id }) => selected.includes(id))
  : COMBINATIONS;
if (combinations.length === 0) fail(`unknown combination: ${selected.join(', ')}`);

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-compat-'));
try {
  const tarballs = pack(join(workDir, 'packs'));
  const report = [];
  for (const combination of combinations) {
    report.push({ id: combination.id, ...verify(combination, tarballs, workDir) });
  }
  console.log('\nAngular compatibility matrix passed:');
  console.table(report);
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
