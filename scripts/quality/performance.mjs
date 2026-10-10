#!/usr/bin/env node
// `pnpm test:performance` (spec 089): measure the fixed fixture, then judge it against the committed budgets.
//
//   1. apps/performance-baseline `measure`  — database calls, latency distributions, upload, memory and
//      admin list rendering on the fixed on-disk libSQL dataset  → .quality/performance/{runtime,render}.json
//   2. scripts/quality/bundle-size.mjs      — production browser bundle sizes of the R01 packed consumers
//      → .quality/performance/bundle.json   (skip with --skip-bundle)
//   3. this file                            — resolves every metric in performance-budgets.json, compares it, writes
//      .quality/performance/{results,summary}.json, prints a table and exits 1 on a hard-gate violation.
//
// Requires built packages (`pnpm build`). Local, deterministic fixture; no network, no cloud, no Docker.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from './judge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, '.quality', 'performance');
const budgets = JSON.parse(
  readFileSync(join(root, 'scripts/quality/performance-budgets.json'), 'utf8')
);
const skipBundle = process.argv.includes('--skip-bundle');
const judgeOnly = process.argv.includes('--judge-only');

function step(label, command, args) {
  console.log(`\n[performance] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: process.env.CI ?? '' }
  });
  if (result.status !== 0) {
    console.error(`[performance] ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

if (!judgeOnly) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  step('measure the runtime and the admin list', 'pnpm', [
    '--filter',
    '@forge-cms/performance-baseline',
    'measure'
  ]);
  if (!skipBundle)
    step('measure production bundle sizes', 'node', ['scripts/quality/bundle-size.mjs']);
}

const read = (name) => {
  const file = join(out, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};
const results = {
  runtime: read('runtime.json'),
  render: read('render.json'),
  bundle: read('bundle.json')
};

const { rows, hardFailures } = judge(budgets, results, { skipBundle });

const summary = {
  schema: 1,
  fixtureVersion: budgets.fixtureVersion,
  budgetsFrozenFrom: budgets.baselineEnvironment,
  environment: results.runtime?.environment,
  hardFailures,
  metrics: rows
};
writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const cell = (value, width) => String(value ?? '—').padStart(width);
console.log(
  `\n[performance] ${'metric'.padEnd(58)}${'gate'.padEnd(8)}${'value'.padStart(10)}${'budget'.padStart(10)}  status`
);
for (const row of rows) {
  const label = row.unit ? `${row.id} (${row.unit})` : row.id;
  console.log(
    `[performance] ${label.padEnd(58)}${row.gate.padEnd(8)}${cell(row.value, 10)}${cell(row.budget, 10)}  ${row.status}`
  );
}
console.log(
  `\n[performance] ${rows.length} metrics, ${rows.filter((r) => r.gate === 'hard').length} hard-gated; node ${results.runtime?.environment?.node}, ${results.runtime?.environment?.os} ${results.runtime?.environment?.arch}`
);
console.log(`[performance] wrote ${join(out, 'summary.json')}`);
if (hardFailures > 0) {
  console.error(
    `[performance] ${hardFailures} hard budget violation(s) — see OVER BUDGET / MISSING above and docs/specs/089 for how budgets are changed`
  );
  process.exit(1);
}
console.log('[performance] every hard budget holds');
