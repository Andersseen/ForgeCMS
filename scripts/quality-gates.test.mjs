import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  evaluate,
  mergeRuns,
  metricsBelow,
  ownerOf,
  perFile,
  ranges,
  summarise
} from './quality/coverage-lib.mjs';
import { judge } from './quality/judge.mjs';

// Spec 089 — the reliability gates must be able to fail. These tests feed the coverage arithmetic and the
// budget judge synthetic data that is just under / just over a limit and assert the verdict.

const loc = (line) => ({ start: { line, column: 0 }, end: { line, column: 1 } });

/** An istanbul-format file with `hit` of `total` statements covered (one per line), plus one branch with two arms and one function. */
function file({ hit, total, branchArms = [1, 1], fnHits = 1 }) {
  const statementMap = {};
  const s = {};
  for (let i = 0; i < total; i++) {
    statementMap[String(i)] = loc(i + 1);
    s[String(i)] = i < hit ? 1 : 0;
  }
  return {
    statementMap,
    s,
    fnMap: { 0: { name: 'f', loc: loc(1) } },
    f: { 0: fnHits },
    branchMap: { 0: { type: 'if', loc: loc(1), locations: [loc(1), loc(2)] } },
    b: { 0: branchArms }
  };
}

const floors = JSON.parse(
  readFileSync(new URL('./quality/coverage-floors.json', import.meta.url), 'utf8')
);

test('floors cover every public package exactly once, with the QUALITY.md numbers', () => {
  assert.deepEqual(Object.keys(floors.packages).sort(), [
    'admin',
    'angular',
    'api',
    'auth',
    'cloudflare',
    'core',
    'db',
    'runtime',
    's3',
    'storage',
    'testing'
  ]);
  assert.deepEqual(floors.classes['non-ui'], {
    statements: 90,
    lines: 90,
    functions: 90,
    branches: 85
  });
  assert.deepEqual(floors.classes['ui-runtime'], {
    statements: 85,
    lines: 85,
    functions: 85,
    branches: 80
  });
  for (const klass of Object.values(floors.packages)) assert.ok(floors.classes[klass]);
});

test('ownerOf attributes only packages/<name>/src paths', () => {
  assert.equal(ownerOf('/r/packages/core/src/validation.ts'), 'core');
  assert.equal(ownerOf('C:\\r\\packages\\db\\src\\a.ts'), 'db');
  assert.equal(ownerOf('/r/packages/core/dist/index.js'), null);
  assert.equal(ownerOf('/r/apps/www/src/a.ts'), null);
});

test('summarise counts statements, lines, functions and branch arms', () => {
  const totals = summarise([
    {
      path: '/r/packages/core/src/a.ts',
      coverage: file({ hit: 9, total: 10, branchArms: [1, 0], fnHits: 0 })
    }
  ]);
  assert.deepEqual(totals.statements, { covered: 9, total: 10, pct: 90 });
  assert.deepEqual(totals.lines, { covered: 9, total: 10, pct: 90 });
  assert.deepEqual(totals.branches, { covered: 1, total: 2, pct: 50 });
  assert.deepEqual(totals.functions, { covered: 0, total: 1, pct: 0 });
});

test('a package under its floor fails, exactly at the floor passes, and one package cannot cover for another', () => {
  const files = new Map([
    ['/r/packages/core/src/a.ts', file({ hit: 89, total: 100 })], // 89% statements: below 90
    ['/r/packages/db/src/a.ts', file({ hit: 100, total: 100 })] // 100%: must not rescue core
  ]);
  const { report, failures } = evaluate(files, floors, ['core', 'db']);
  assert.equal(report.core.pass, false);
  assert.deepEqual(report.core.below.sort(), ['lines', 'statements']);
  assert.equal(report.db.pass, true);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^core: /);

  const exactly = new Map([['/r/packages/core/src/a.ts', file({ hit: 90, total: 100 })]]);
  assert.equal(evaluate(exactly, floors, ['core']).report.core.pass, true);
});

test('branch floor is separate: 90% statements with 80% branches fails the non-ui class', () => {
  const totals = summarise([
    {
      path: '/r/packages/core/src/a.ts',
      coverage: file({ hit: 100, total: 100, branchArms: [1, 1, 1, 1, 0] })
    }
  ]);
  assert.equal(totals.branches.pct, 80);
  assert.deepEqual(metricsBelow(totals, floors.classes['non-ui']), ['branches']);
  assert.deepEqual(metricsBelow(totals, floors.classes['ui-runtime']), []);
});

test('mergeRuns sums a file executed by several suites and refuses incompatible maps', () => {
  const a = { '/r/packages/testing/src/c.ts': file({ hit: 1, total: 2 }) };
  const b = { '/r/packages/testing/src/c.ts': file({ hit: 2, total: 2 }) };
  const merged = mergeRuns({ db: a, auth: b }).get('/r/packages/testing/src/c.ts');
  assert.deepEqual(merged.s, { 0: 2, 1: 1 });
  const other = file({ hit: 1, total: 3 });
  assert.throws(
    () => mergeRuns({ db: a, auth: { '/r/packages/testing/src/c.ts': other } }),
    /incompatible coverage maps/
  );
});

test('perFile lists the uncovered lines compactly', () => {
  assert.equal(ranges([3, 4, 5, 9, 9, 11, 12]), '3-5, 9, 11-12');
  const [entry] = perFile(
    new Map([['/r/packages/core/src/a.ts', file({ hit: 7, total: 10, branchArms: [1, 0] })]])
  );
  assert.equal(entry.package, 'core');
  assert.equal(entry.file, 'packages/core/src/a.ts');
  assert.equal(entry.uncoveredLines, '2, 8-10');
});

// ---- performance budgets ------------------------------------------------------------------------------------

const budgets = {
  metrics: [
    { id: 'calls', path: ['runtime', 'calls'], baseline: 2, budget: 2, gate: 'hard', exact: true },
    { id: 'bytes', path: ['bundle', 'bytes'], baseline: 100, budget: 105, gate: 'hard' },
    { id: 'heap', path: ['runtime', 'heap'], baseline: 25, budget: 100, review: 45, gate: 'hard' },
    {
      id: 'ratio',
      ratio: [
        ['runtime', 'big'],
        ['runtime', 'small']
      ],
      baseline: 5,
      budget: 12,
      gate: 'hard'
    },
    { id: 'latency', path: ['runtime', 'ms'], baseline: 1, budget: null, gate: 'report' },
    { id: 'soft', path: ['runtime', 'soft'], baseline: 1, budget: 2, gate: 'report' }
  ]
};
const healthy = {
  runtime: { calls: 2, heap: 26, big: 50, small: 10, ms: 99, soft: 1 },
  bundle: { bytes: 100 }
};
const statusOf = (results, options) =>
  Object.fromEntries(judge(budgets, results, options).rows.map((r) => [r.id, r.status]));

test('a healthy run passes with no hard failures', () => {
  const verdict = judge(budgets, healthy);
  assert.equal(verdict.hardFailures, 0);
  assert.equal(statusOf(healthy).latency, 'recorded');
});

test('one extra database call, a larger bundle, a leak or a worse scaling ratio each fail a hard gate', () => {
  for (const [patch, id] of [
    [{ runtime: { ...healthy.runtime, calls: 3 } }, 'calls'],
    [{ bundle: { bytes: 106 } }, 'bytes'],
    [{ runtime: { ...healthy.runtime, heap: 101 } }, 'heap'],
    [{ runtime: { ...healthy.runtime, big: 130 } }, 'ratio']
  ]) {
    const verdict = judge(budgets, { ...healthy, ...patch });
    assert.equal(verdict.hardFailures, 1, id);
    assert.equal(statusOf({ ...healthy, ...patch })[id], 'OVER BUDGET');
  }
});

test('exactly at budget passes, between review and budget warns, below baseline is flagged improved', () => {
  assert.equal(statusOf({ ...healthy, bundle: { bytes: 105 } }).bytes, 'ok');
  assert.equal(statusOf({ ...healthy, runtime: { ...healthy.runtime, heap: 60 } }).heap, 'review');
  assert.equal(
    statusOf({ ...healthy, runtime: { ...healthy.runtime, calls: 1 } }).calls,
    'improved'
  );
});

test('a report-only metric over its figure never fails the gate; a missing hard metric always does', () => {
  const over = { ...healthy, runtime: { ...healthy.runtime, soft: 50 } };
  assert.equal(judge(budgets, over).hardFailures, 0);
  assert.equal(statusOf(over).soft, 'over (report-only)');
  const missing = { runtime: healthy.runtime }; // no bundle section
  assert.equal(judge(budgets, missing).hardFailures, 1);
  assert.equal(statusOf(missing).bytes, 'MISSING');
  assert.equal(judge(budgets, missing, { skipBundle: true }).hardFailures, 0);
});

test('the committed budgets are well-formed: unique ids, hard gates carry a number, every metric has a rationale', () => {
  const committed = JSON.parse(
    readFileSync(new URL('./quality/performance-budgets.json', import.meta.url), 'utf8')
  );
  const ids = committed.metrics.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const metric of committed.metrics) {
    assert.ok(['hard', 'report'].includes(metric.gate), metric.id);
    assert.ok(
      metric.rationale && metric.sensitivity,
      `${metric.id} needs a rationale and a sensitivity`
    );
    if (metric.gate === 'hard') assert.equal(typeof metric.budget, 'number', metric.id);
    if (metric.gate === 'hard' && metric.baseline !== undefined) {
      assert.ok(metric.budget >= metric.baseline, `${metric.id}: budget below its own baseline`);
    }
  }
});
