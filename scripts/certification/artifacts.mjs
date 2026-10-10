// The one exact packed-artifact set of a certification run (spec 088, roadmap 0.12 / R01).
//
// Repository tooling only — not a Forge package API. Every packed verifier (`release:verify`,
// `release:compat`, `release:ssr`, `test:s3`) used to run its own `pnpm pack`, so two verifiers in one run could
// in principle certify two different trees. This module is now the only place that packs:
//
//   - `packArtifacts(dir)`   packs the public packages once, hashes every tarball, inspects what a registry
//                            consumer would receive, and writes `artifacts.json` next to them.
//   - `FORGE_CERT_ARTIFACTS` (a directory holding that manifest): when set, every verifier consumes THAT set
//                            through `resolveTarballs()` and can never silently repack a different tree. The
//                            hashes are re-checked on every load.
//   - Standalone `pnpm release:verify` etc. still work: without the variable they pack once into their own
//                            temporary directory through the very same code.
//
// The manifest never contains secrets, credentials, cookies or host-specific temporary paths.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';

/** The eleven public packages (the Changesets `fixed` family). */
export const PUBLIC_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/s3',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/angular',
  '@forge-cms/admin',
  '@forge-cms/testing'
];

/** Directory holding `artifacts.json` + the tarballs of the run being certified. */
export const ARTIFACTS_ENV = 'FORGE_CERT_ARTIFACTS';
export const MANIFEST_FILE = 'artifacts.json';

/** The only subpaths a consumer may import besides a package root (spec 087 freeze). */
export const RETAINED_SUBPATHS = [
  '@forge-cms/angular/server',
  '@forge-cms/angular/vite',
  '@forge-cms/admin/vite',
  '@forge-cms/testing/contracts'
];

const FUNCTIONAL_KEYS = [
  'main',
  'module',
  'types',
  'typings',
  'bin',
  'exports',
  'imports',
  'files',
  'dependencies',
  'peerDependencies',
  'optionalDependencies'
];
const WORKSPACE_PROTOCOLS = ['workspace:', 'catalog:', 'link:', 'file:'];
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies'
];

const repoRoot = () => process.cwd();

function capture(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

export const tarballPrefix = (name) => `${name.replace('@', '').replace('/', '-')}-`;

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The git identity of the tree being certified. */
export function gitIdentity() {
  const commit = capture('git', ['rev-parse', 'HEAD']).trim();
  const dirtyFiles = capture('git', ['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  return { commit, dirty: dirtyFiles.length > 0, dirtyFileCount: dirtyFiles.length };
}

/** Every `exports` target (string leaves) of a package.json, as paths relative to the package root. */
export function exportTargets(exportsField) {
  const targets = [];
  const walk = (value) => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(exportsField);
  return targets;
}

/**
 * Pure integrity check of one packed package, from its packed `package.json` and the file list of the tarball.
 * Returns problems (never throws) so a unit test can pin each rule.
 */
export function inspectPackedPackage({ expectedName, pkg, files, alignedVersion }) {
  const problems = [];
  const label = expectedName;
  if (pkg.name !== expectedName) problems.push(`${label}: packed name is ${pkg.name}`);
  if (pkg.version !== alignedVersion) {
    problems.push(
      `${label}: version ${pkg.version} is not the aligned family version ${alignedVersion}`
    );
  }
  if (pkg.type !== 'module') problems.push(`${label}: "type" is not "module"`);
  if (!pkg.exports?.['.']) problems.push(`${label}: no root export`);

  for (const section of DEPENDENCY_SECTIONS) {
    for (const [dependency, range] of Object.entries(pkg[section] ?? {})) {
      if (WORKSPACE_PROTOCOLS.some((protocol) => String(range).startsWith(protocol))) {
        problems.push(
          `${label}: ${section}.${dependency} is "${range}", which a registry consumer cannot resolve`
        );
      }
      if (
        dependency.startsWith('@forge-cms/') &&
        section !== 'devDependencies' &&
        range !== alignedVersion &&
        range !== `^${alignedVersion}`
      ) {
        problems.push(
          `${label}: ${section}.${dependency} is "${range}", expected ${alignedVersion} (the packed family version)`
        );
      }
    }
  }

  const fileSet = new Set(files);
  for (const target of exportTargets(pkg.exports)) {
    const relative = target.replace(/^\.\//, '');
    if (!fileSet.has(relative))
      problems.push(`${label}: export target ${target} is not in the tarball`);
    if (relative.startsWith('src/'))
      problems.push(`${label}: export target ${target} points at src/`);
  }
  if (!fileSet.has('README.md')) problems.push(`${label}: README.md is missing`);
  if (files.some((file) => file.startsWith('src/') || file.startsWith('tsconfig'))) {
    problems.push(`${label}: tarball ships src/ or tsconfig files`);
  }
  // Metadata (`repository`, `homepage`) legitimately names packages/<name>; resolution-relevant keys may not.
  const functional = {};
  for (const key of FUNCTIONAL_KEYS) if (key in pkg) functional[key] = pkg[key];
  if (JSON.stringify(functional).includes('packages/')) {
    problems.push(`${label}: package.json resolves through a repository "packages/" path`);
  }
  return problems;
}

function readPacked(tarball) {
  const pkg = JSON.parse(capture('tar', ['-xzOf', tarball, 'package/package.json']));
  const files = capture('tar', ['-tzf', tarball])
    .split('\n')
    .filter((line) => line && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));
  return { pkg, files };
}

/**
 * Packs `names` (default: all eleven) once into `dir`, hashes and inspects every tarball and writes the manifest.
 * `log` receives the pnpm command lines (kept quiet by default).
 */
export function packArtifacts(dir, { names = PUBLIC_PACKAGES, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const git = gitIdentity();
  const packages = [];
  for (const name of names) {
    const before = new Set(readdirSync(dir));
    log(`$ pnpm --filter ${name} pack`);
    capture('pnpm', ['--filter', name, 'pack', '--pack-destination', dir]);
    const created = readdirSync(dir).filter(
      (entry) =>
        !before.has(entry) && entry.startsWith(tarballPrefix(name)) && entry.endsWith('.tgz')
    );
    if (created.length !== 1)
      throw new Error(`expected exactly one new tarball for ${name}, got ${created.length}`);
    const file = created[0];
    const { pkg, files } = readPacked(join(dir, file));
    packages.push({
      name,
      version: pkg.version,
      file,
      sha256: sha256(join(dir, file)),
      bytes: readFileSync(join(dir, file)).length,
      type: pkg.type,
      exports: pkg.exports,
      forgeDependencies: Object.fromEntries(
        ['dependencies', 'peerDependencies', 'optionalDependencies']
          .flatMap((section) => Object.entries(pkg[section] ?? {}))
          .filter(([dependency]) => dependency.startsWith('@forge-cms/'))
      ),
      peerDependencies: pkg.peerDependencies ?? {},
      _files: files,
      _pkg: pkg
    });
  }
  const alignedVersion = packages[0].version;
  const problems = packages.flatMap((entry) =>
    inspectPackedPackage({
      expectedName: entry.name,
      pkg: entry._pkg,
      files: entry._files,
      alignedVersion
    })
  );
  for (const entry of packages) {
    delete entry._files;
    delete entry._pkg;
  }
  if (problems.length > 0) {
    throw new Error(`packed artifacts are not consumable:\n  - ${problems.join('\n  - ')}`);
  }

  const manifest = {
    schema: 1,
    certifiedAt: new Date().toISOString(),
    complete: PUBLIC_PACKAGES.every((name) => names.includes(name)),
    git,
    version: alignedVersion,
    toolchain: {
      node: process.version,
      pnpm: capture('pnpm', ['--version']).trim(),
      platform: platform(),
      arch: arch()
    },
    packages
  };
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Loads a previously packed set and re-verifies every tarball hash. Throws on any mismatch or absence. */
export function loadArtifacts(dir) {
  const manifestFile = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestFile)) throw new Error(`${ARTIFACTS_ENV}: ${MANIFEST_FILE} not found`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const entry of manifest.packages) {
    const file = join(dir, entry.file);
    if (!existsSync(file)) throw new Error(`artifact ${entry.name}: ${entry.file} is missing`);
    if (sha256(file) !== entry.sha256) {
      throw new Error(
        `artifact ${entry.name}: ${entry.file} no longer matches its recorded SHA-256`
      );
    }
  }
  return manifest;
}

/**
 * What every packed verifier calls instead of `pnpm pack`: the certified set when `FORGE_CERT_ARTIFACTS` is set
 * (hash-checked, never repacked), otherwise a fresh one-off pack into `fallbackDir`.
 * Returns `[{ name, path, sha256 }]` for the requested names.
 */
export function resolveArtifacts(fallbackDir, names = PUBLIC_PACKAGES, options = {}) {
  const certified = process.env[ARTIFACTS_ENV];
  const dir = certified ?? fallbackDir;
  const manifest = certified
    ? loadArtifacts(certified)
    : packArtifacts(fallbackDir, { names, ...options });
  return names.map((name) => {
    const entry = manifest.packages.find((candidate) => candidate.name === name);
    if (!entry) throw new Error(`${name} is not part of the artifact set`);
    return { name, path: join(dir, entry.file), sha256: entry.sha256, version: entry.version };
  });
}

/** `resolveArtifacts` shaped as the `{ name: 'file:/abs.tgz' }` map consumer manifests use. */
export function resolveTarballs(fallbackDir, names = PUBLIC_PACKAGES, options = {}) {
  return Object.fromEntries(
    resolveArtifacts(fallbackDir, names, options).map((entry) => [entry.name, `file:${entry.path}`])
  );
}

// ---------------------------------------------------------------------------------------------------------
// Clean-consumer scan

const SCANNED_FILE = /\.(?:[cm]?[jt]sx?|json|html|toml|jsonc)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.analog', '.nitro', '.vite']);

function sourceFiles(dir, relative = '') {
  const output = [];
  for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) output.push(...sourceFiles(dir, next));
    } else if (SCANNED_FILE.test(entry.name)) {
      output.push(next);
    }
  }
  return output;
}

/** Pure scan of one generated consumer file; returns problems. Exported for unit tests. */
export function scanConsumerFile(file, text) {
  const problems = [];
  if (file === 'package.json') {
    const manifest = JSON.parse(text);
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (String(range).startsWith('workspace:') || String(range).startsWith('link:')) {
          problems.push(`${file}: ${section}.${name} is "${range}"`);
        }
        if (
          name.startsWith('@forge-cms/') &&
          !String(range).startsWith('file:') &&
          section !== 'peerDependencies'
        ) {
          problems.push(`${file}: ${section}.${name} is "${range}", not a packed tarball`);
        }
      }
    }
    return problems;
  }
  if (file.endsWith('.json') && /tsconfig/.test(file)) {
    if (/"paths"\s*:/.test(text) && /@forge-cms/.test(text)) {
      problems.push(`${file}: a tsconfig path alias maps a @forge-cms package`);
    }
  }
  if (/(?:^|['"`/])(?:\.\.\/)+packages\//.test(text) || /packages\/[a-z-]+\/src/.test(text)) {
    problems.push(`${file}: reaches into repository packages/*`);
  }
  for (const match of text.matchAll(/['"`](@forge-cms\/[a-z0-9-]+)(\/[^'"`]*)?['"`]/g)) {
    const specifier = `${match[1]}${match[2] ?? ''}`;
    if (match[2] && !RETAINED_SUBPATHS.includes(specifier)) {
      problems.push(`${file}: imports ${specifier}, which is not a retained public subpath`);
    }
  }
  return problems;
}

/** Throws if a generated consumer takes a workspace/private shortcut. Run before `pnpm install`. */
export function assertCleanConsumer(dir, label = dir) {
  const problems = sourceFiles(dir).flatMap((file) =>
    scanConsumerFile(file, readFileSync(join(dir, file), 'utf8'))
  );
  if (problems.length > 0) {
    throw new Error(`${label} is not a clean external consumer:\n  - ${problems.join('\n  - ')}`);
  }
}
