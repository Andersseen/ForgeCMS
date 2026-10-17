#!/usr/bin/env node
// Registry vs. certified artifact comparison (roadmap L02, J11). Repository tooling only.
//
// Compares what npm serves for `@forge-cms/*@<version>` with the tarballs that were certified, by CONTENT:
// the file list, every file's SHA-256 (the packed `package.json` is compared after recursive key sorting, because
// pnpm's `workspace:` rewrite is allowed to reorder dependency keys), the executable bit of every file, and the
// functional manifest keys (exports, bin, dependencies, peerDependencies, ...). A compressed-tarball hash is
// reported for information only and never decides the outcome.
//
// Usage: node scripts/registry/artifact-compare.mjs --version 1.0.0-rc.2 --local <dir of tarballs> [--packages a,b]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PUBLIC_PACKAGES, sha256, tarballPrefix } from '../certification/artifacts.mjs';

/** Manifest keys whose differences change what a consumer receives. */
export const FUNCTIONAL_KEYS = [
  'name',
  'version',
  'type',
  'main',
  'module',
  'types',
  'typings',
  'bin',
  'exports',
  'imports',
  'files',
  'sideEffects',
  'engines',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies'
];

/** Recursively sorts object keys so key order never counts as a difference. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])])
    );
  }
  return value;
}

export const normalizedManifest = (text) => JSON.stringify(sortKeys(JSON.parse(text)));

/**
 * Pure comparison of two unpacked packages. Each side: `{ files: Map<path, { digest, executable }>, manifest }`
 * where a manifest file's digest has already been taken over its normalized text. Returns problems (never throws).
 */
export function compareUnpacked(name, certified, published) {
  const problems = [];
  for (const path of certified.files.keys()) {
    if (!published.files.has(path))
      problems.push(`${name}: ${path} is certified but not published`);
  }
  for (const path of published.files.keys()) {
    if (!certified.files.has(path))
      problems.push(`${name}: ${path} is published but not certified`);
  }
  for (const [path, entry] of certified.files) {
    const other = published.files.get(path);
    if (!other) continue;
    if (entry.digest !== other.digest) problems.push(`${name}: ${path} differs in content`);
    if (entry.executable !== other.executable) {
      problems.push(
        `${name}: ${path} executable bit differs (certified ${entry.executable}, published ${other.executable})`
      );
    }
  }
  for (const key of FUNCTIONAL_KEYS) {
    const a = JSON.stringify(sortKeys(certified.manifest[key] ?? null));
    const b = JSON.stringify(sortKeys(published.manifest[key] ?? null));
    if (a !== b) problems.push(`${name}: package.json "${key}" differs`);
  }
  return problems;
}

function walk(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Extracts a tarball into `into` and returns its comparable description. */
export function unpack(tarball, into) {
  mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', into]);
  const root = join(into, 'package');
  const files = new Map();
  for (const file of walk(root)) {
    const path = relative(root, file).split('\\').join('/');
    const text = readFileSync(file);
    const digest =
      path === 'package.json'
        ? createHash('sha256')
            .update(normalizedManifest(text.toString('utf8')))
            .digest('hex')
        : createHash('sha256').update(text).digest('hex');
    files.set(path, { digest, executable: (statSync(file).mode & 0o111) !== 0 });
  }
  return { files, manifest: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) };
}

function fetchPublished(name, version, dir) {
  mkdirSync(dir, { recursive: true });
  const out = execFileSync(
    'npm',
    ['pack', `${name}@${version}`, '--pack-destination', dir, '--prefer-online', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const [info] = JSON.parse(out);
  return join(dir, info.filename);
}

export function compareAgainstRegistry({
  version,
  localDir,
  names = PUBLIC_PACKAGES,
  log = console.log
}) {
  const work = mkdtempSync(join(tmpdir(), 'forge-registry-compare-'));
  const problems = [];
  try {
    for (const name of names) {
      const local = readdirSync(localDir).filter(
        (entry) => entry.startsWith(tarballPrefix(name)) && entry.endsWith(`${version}.tgz`)
      );
      if (local.length !== 1) {
        problems.push(
          `${name}: expected one certified ${version} tarball in ${localDir}, got ${local.length}`
        );
        continue;
      }
      const certifiedTarball = join(localDir, local[0]);
      const publishedTarball = fetchPublished(name, version, join(work, 'registry', name));
      const slug = name.replace('/', '__');
      const certified = unpack(certifiedTarball, join(work, 'certified', slug));
      const published = unpack(publishedTarball, join(work, 'published', slug));
      const found = compareUnpacked(name, certified, published);
      const same = sha256(certifiedTarball) === sha256(publishedTarball);
      log(
        `${found.length === 0 ? '✓' : '✗'} ${name}@${version}: ${certified.files.size} files, ` +
          `${found.length === 0 ? 'content identical' : `${found.length} difference(s)`}` +
          `${same ? ' (tarball hash identical)' : ' (tarball hash differs; informational)'}`
      );
      log(`    registry sha256 ${sha256(publishedTarball)}`);
      problems.push(...found);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const version = option('--version');
  const localDir = option('--local');
  if (!version || !localDir) {
    throw new Error('usage: artifact-compare.mjs --version <v> --local <dir> [--packages a,b]');
  }
  const names = option('--packages')?.split(',') ?? PUBLIC_PACKAGES;
  const problems = compareAgainstRegistry({ version, localDir, names });
  if (problems.length > 0) {
    console.error(`\n${problems.length} difference(s):\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(
    '\nRegistry artifacts match the certified artifacts (content, executables, exports, dependencies).'
  );
}
