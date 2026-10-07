// Helpers shared by the packed production SSR consumers (specs 078, 080, 081 — roadmap 0.9).
// `pnpm release:ssr` (scripts/verify-ssr-consumer.mjs) is the entry point; see there for what is proven.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The versions the first-party apps use (the C03 `current` combination plus the SSR pieces). */
export const VERSIONS = {
  angular: '21.2.10',
  analog: '2.5.2',
  typescript: '5.9.2',
  rxjs: '7.8.2',
  vite: '7.1.4',
  babel: '7.29.0',
  h3: '1.15.0',
  zone: '0.15.1',
  wrangler: '4.91.0',
  voltui: '1.0.1',
  lumenIcons: '0.2.0',
  cdk: '21.2.10',
  // Non-optional peers of `@analogjs/platform` itself (its content pipeline), not of Forge.
  marked: '15.0.12',
  markedGfmHeadingId: '4.1.4',
  markedMangle: '1.1.13'
};

/** Every Forge package a packed consumer may install. Each fixture depends on the ones it uses. */
export const FORGE_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/angular',
  '@forge-cms/admin'
];

export const repoRoot = process.cwd();
export const keep = process.env.FORGE_CMS_KEEP_SSR_TMP === '1';

export function run(command, args, cwd, env = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', ...env }
  });
}

export function fail(message) {
  throw new Error(message);
}

export function write(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
}

/** Packs every Forge package once; the result maps package name → `file:` tarball. */
export function pack(dir) {
  mkdirSync(dir, { recursive: true });
  const tarballs = {};
  for (const name of FORGE_PACKAGES) {
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

export const ng = (name) => [`@angular/${name}`, VERSIONS.angular];

/** Strict peers, no automatic peer installation (the C03 foundation). */
export const NPMRC = 'strict-peer-dependencies=true\nauto-install-peers=false\n';

export const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    isolatedModules: true,
    types: []
  },
  angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
  include: ['src/**/*.ts']
};

/** The Angular + Analog + Vite build tools every SSR consumer needs (none of them are Forge peers). */
export function buildTools() {
  return {
    '@analogjs/platform': VERSIONS.analog,
    '@analogjs/vite-plugin-angular': VERSIONS.analog,
    '@angular/build': VERSIONS.angular,
    '@angular/compiler-cli': VERSIONS.angular,
    '@babel/core': VERSIONS.babel,
    typescript: VERSIONS.typescript,
    vite: VERSIONS.vite,
    // Non-optional peers of `@analogjs/platform` itself (its content pipeline).
    marked: VERSIONS.marked,
    'marked-gfm-heading-id': VERSIONS.markedGfmHeadingId,
    'marked-mangle': VERSIONS.markedMangle,
    // Not Forge peers: the WebAssembly fallback of @angular/build's bundler (see verify-angular-compat).
    '@emnapi/core': '^1.7.1',
    '@emnapi/runtime': '^1.7.1'
  };
}

export function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => /\.m?js$/.test(file))
    .map((file) => join(dir, file));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Playwright from a first-party app that already pins it (the packed consumers deliberately have none). */
export async function loadChromium() {
  const require = createRequire(join(repoRoot, 'apps', 'tiny-project', 'package.json'));
  return require('@playwright/test').chromium;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The parsed `ng-state` JSON of a server-rendered page (Angular's own serialization). */
export function transferState(html, label) {
  const match = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`${label}: ng-state is not valid JSON (${error})`);
  }
}

export const forgeEntries = (state) =>
  Object.entries(state).filter(([key]) => key.startsWith('forge:public:'));
