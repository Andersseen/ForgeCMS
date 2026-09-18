#!/usr/bin/env node
// Public-surface diff (spec 058 §12): a lightweight snapshot of every published package's exported
// symbol names, so an accidental removal/rename is visible in review before publishing — not a
// formal API-extractor/codegen platform, just "does the exported name list still match what we
// committed to last time". Run after `pnpm build` (needs real `dist/*.d.ts` files to read).
//
// Usage:
//   node scripts/check-public-api.mjs           # compare dist/*.d.ts exports against api-baseline/
//   node scripts/check-public-api.mjs --update  # regenerate api-baseline/ from the current dist/*.d.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE_DIR = join(ROOT, 'api-baseline');
const UPDATE = process.argv.includes('--update');

/**
 * Extracts top-level exported symbol names from a `.d.ts` file's text. Deliberately simple —
 * matches the declaration forms `tsc` actually emits for this repo's packages: `export declare
 * <kind> Name`, `export interface Name`, `export type Name`, and `export { A, B as C }` /
 * `export type { A, B }` re-export lists. Not a full TS parser; it does not need to be one to catch
 * "a name that used to be exported no longer is".
 */
function extractExportedNames(dtsText) {
  const names = new Set();

  const declPattern =
    /^export\s+declare\s+(?:abstract\s+)?(?:class|function|const|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of dtsText.matchAll(declPattern)) names.add(match[1]);

  const directPattern = /^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of dtsText.matchAll(directPattern)) names.add(match[1]);

  const listPattern = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const match of dtsText.matchAll(listPattern)) {
    const entries = match[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const asMatch = /^(?:type\s+)?[\w$]+\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry);
      const bare = /^(?:type\s+)?([A-Za-z_$][\w$]*)$/.exec(entry);
      const name = asMatch?.[1] ?? bare?.[1];
      if (name) names.add(name);
    }
  }

  return [...names].sort();
}

function loadPackages() {
  const packages = [];
  for (const pkgJsonPath of globSync('packages/*/package.json', { cwd: ROOT })) {
    const pkg = JSON.parse(readFileSync(join(ROOT, pkgJsonPath), 'utf8'));
    if (pkg.private) continue;
    const pkgDir = dirname(pkgJsonPath);
    const exportsMap = typeof pkg.exports === 'object' ? pkg.exports : { '.': pkg.exports };
    for (const [subpath, target] of Object.entries(exportsMap)) {
      const typesRelPath = typeof target === 'string' ? target : target?.types;
      if (!typesRelPath) continue;
      const entryName = subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
      packages.push({ entryName, dtsPath: join(ROOT, pkgDir, typesRelPath) });
    }
  }
  return packages;
}

function baselineFileFor(entryName) {
  return join(BASELINE_DIR, `${entryName.replace(/[@/]/g, '_')}.json`);
}

const entries = loadPackages();
let hasDiff = false;

for (const { entryName, dtsPath } of entries) {
  if (!existsSync(dtsPath)) {
    console.error(`✗ ${entryName}: ${dtsPath} does not exist — run \`pnpm build\` first.`);
    hasDiff = true;
    continue;
  }

  const current = extractExportedNames(readFileSync(dtsPath, 'utf8'));
  const baselinePath = baselineFileFor(entryName);

  if (UPDATE) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(`↻ ${entryName}: wrote ${current.length} exported names to ${baselinePath}`);
    continue;
  }

  if (!existsSync(baselinePath)) {
    console.error(
      `✗ ${entryName}: no baseline at ${baselinePath} — run with --update once to create it.`
    );
    hasDiff = true;
    continue;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const removed = baseline.filter((name) => !current.includes(name));
  const added = current.filter((name) => !baseline.includes(name));

  if (removed.length === 0 && added.length === 0) {
    console.log(`✓ ${entryName}: unchanged (${current.length} exports)`);
    continue;
  }

  hasDiff = true;
  console.error(`✗ ${entryName}: public surface changed since the committed baseline`);
  if (removed.length > 0) console.error(`  removed: ${removed.join(', ')}`);
  if (added.length > 0) console.error(`  added:   ${added.join(', ')}`);
}

if (hasDiff) {
  console.error(
    '\nIf this change is intentional, run `node scripts/check-public-api.mjs --update` and commit the updated api-baseline/*.json.'
  );
  process.exit(1);
}

console.log('\nPublic API surface matches the committed baseline.');
