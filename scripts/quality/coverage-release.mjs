#!/usr/bin/env node
// Release coverage gate (spec 089). Runs each package's own Vitest environment with source-attributed
// V8 coverage (scripts/quality/vitest.coverage.config.mjs), merges the raw istanbul reports per file,
// computes per-PACKAGE totals, writes machine- and human-readable summaries, and fails when any
// package is under its class floor (scripts/quality/coverage-floors.json). No package can borrow
// another package's numbers.
//
//   node scripts/quality/coverage-release.mjs            # run + gate
//   node scripts/quality/coverage-release.mjs --no-run   # re-aggregate coverage/raw only
//   node scripts/quality/coverage-release.mjs --only core,db
//
// Output (gitignored): coverage/packages.json, coverage/summary.md, coverage/raw/<pkg>/coverage-final.json
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, mergeRuns, perFile } from './coverage-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const floors = JSON.parse(
  readFileSync(path.join(root, 'scripts/quality/coverage-floors.json'), 'utf8')
);
const config = path.join(root, 'scripts/quality/vitest.coverage.config.mjs');
const args = process.argv.slice(2);
const noRun = args.includes('--no-run');
const onlyIndex = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
const onlyValue =
  onlyIndex === -1
    ? undefined
    : args[onlyIndex].includes('=')
      ? args[onlyIndex].split('=')[1]
      : args[onlyIndex + 1];
const only = onlyValue ? new Set(onlyValue.split(',')) : null;
const packages = Object.keys(floors.packages).filter((p) => !only || only.has(p));

function runPackage(pkg) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'vitest', 'run', '--config', config], {
      cwd: path.join(root, 'packages', pkg),
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ pkg, code, out }));
  });
}

async function runAll() {
  const queue = [...packages];
  const results = [];
  const workers = Array.from(
    { length: Math.max(1, Math.min(4, os.cpus().length >> 1)) },
    async () => {
      while (queue.length) {
        const pkg = queue.shift();
        const r = await runPackage(pkg);
        const tests = /Tests\s+(.*)/.exec(r.out)?.[1] ?? 'no test summary';
        console.log(`[coverage] ${pkg.padEnd(11)} ${r.code === 0 ? 'ok  ' : 'FAIL'} ${tests}`);
        if (r.code !== 0) console.log(r.out.split('\n').slice(-40).join('\n'));
        results.push(r);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

if (!noRun) {
  const results = await runAll();
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    console.error(
      `[coverage] test failures in: ${failed.map((r) => r.pkg).join(', ')} — coverage is meaningless over failing tests`
    );
    process.exit(1);
  }
}

const runs = {};
for (const pkg of packages) {
  const file = path.join(root, 'coverage', 'raw', pkg, 'coverage-final.json');
  if (!existsSync(file)) throw new Error(`missing raw coverage for ${pkg}: ${file}`);
  runs[pkg] = JSON.parse(readFileSync(file, 'utf8'));
}
const merged = mergeRuns(runs);
const { report: perPackage, failures } = evaluate(merged, floors, packages);
const report = { schema: 1, node: process.version, floors: floors.classes, packages: perPackage };

mkdirSync(path.join(root, 'coverage'), { recursive: true });
writeFileSync(path.join(root, 'coverage', 'packages.json'), JSON.stringify(report, null, 2) + '\n');
const md = [
  '| package | class | stmts | branches | funcs | lines | result |',
  '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ...Object.entries(report.packages).map(
    ([p, r]) =>
      `| @forge-cms/${p} | ${r.class} | ${r.statements.pct} | ${r.branches.pct} | ${r.functions.pct} | ${r.lines.pct} | ${r.pass ? 'pass' : 'BELOW: ' + r.below.join(', ')} |`
  )
].join('\n');
writeFileSync(path.join(root, 'coverage', 'summary.md'), md + '\n');
const files = perFile(merged).filter((entry) => packages.includes(entry.package));
writeFileSync(path.join(root, 'coverage', 'files.json'), JSON.stringify(files, null, 2) + '\n');
writeFileSync(
  path.join(root, 'coverage', 'uncovered.md'),
  files
    .filter((entry) => entry.uncoveredLines !== '')
    .map(
      (entry) =>
        `- ${entry.file} (stmts ${entry.statements}%, branches ${entry.branches}%): ${entry.uncoveredLines}`
    )
    .join('\n') + '\n'
);
if (only) {
  console.log(
    '[coverage] PARTIAL run (--only): contract sources are attributed only by a full run — do not read these numbers as a release result'
  );
}
console.log('\n' + md + '\n');
if (failures.length) {
  console.error('[coverage] BELOW FLOOR:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('[coverage] every package meets its class floor');
