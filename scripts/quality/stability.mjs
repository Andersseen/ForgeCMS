#!/usr/bin/env node
// Repeated, isolated runs of the critical journeys (spec 089 §Stability). Retries are forced OFF so a
// first-attempt failure is a failure, and every run's first-attempt result, duration and failing test
// names are recorded — a retry is a diagnostic tool, never a way to turn red into green.
//
//   node scripts/quality/stability.mjs                    # the default sample (see JOURNEYS)
//   node scripts/quality/stability.mjs --only tiny-project --runs 10
//   node scripts/quality/stability.mjs --profile ci       # the smaller sample the CI reliability job runs
//
// Writes .quality/stability/results.json. Exit 1 if ANY run of ANY journey failed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, '.quality', 'stability');

const playwright = (pkg, args) => ({
  kind: 'playwright',
  command: ['pnpm', '--filter', pkg, 'exec', 'playwright', 'test', '--retries=0', ...args]
});

/**
 * `runs`: independent executions in a fresh process. `ci`: the sample the CI job uses. Chosen from suite
 * duration, the known failure rate and the risk (spec 089): the theme test failed ~1 in 40 before its fix,
 * so it gets 100 repeats of the two affected tests; the tiny-project journey (28 s) gets many runs.
 */
const JOURNEYS = [
  {
    id: 'www-theme-flake',
    description:
      'the formerly flaky light/dark theme journey (Home → Demo → Docs → reload), 100 repeats under 8 workers',
    ...playwright('@forge-cms/www', [
      'e2e/theme.spec.ts',
      '-g',
      'theme is consistent',
      '--repeat-each=100',
      '--workers=8'
    ]),
    runs: 1,
    ci: { runs: 1, args: ['--repeat-each=40', '--workers=4'] }
  },
  {
    id: 'www-e2e',
    description: 'the whole apps/www browser suite (landing, docs, admin, auth)',
    ...playwright('@forge-cms/www', []),
    runs: 3,
    ci: { runs: 2 }
  },
  {
    id: 'tiny-project',
    description: 'tiny-project admin / auth / content / role journeys against the real runtime',
    ...playwright('@forge-cms/tiny-project', []),
    runs: 5,
    ci: { runs: 3 }
  },
  {
    id: 'demo-aesthetics',
    description: 'the demo app public site + admin content journeys',
    ...playwright('@forge-cms/demo-aesthetics', []),
    runs: 3,
    ci: { runs: 2 }
  },
  {
    id: 'packed-ssr-technical',
    description:
      'the packed production SSR consumer: concurrent identities, hydration in Chromium, transfer-state checks',
    kind: 'command',
    command: ['node', 'scripts/verify-ssr-consumer.mjs', 'technical'],
    runs: 3,
    ci: { runs: 2 }
  },
  {
    id: 'cloudflare-local',
    description: 'local workerd + D1 + R2 integration (durable-profile contracts)',
    kind: 'command',
    command: ['pnpm', 'test:cloudflare', '--force'],
    runs: 3,
    ci: { runs: 2 }
  },
  {
    id: 'durable-profiles-s3',
    description:
      'the packed production journey on Node + on-disk libSQL + real S3 (Garage) and on workerd + D1 + R2: bootstrap, publish, SSR, hydrate, upload, restart, delete (needs Docker)',
    kind: 'command',
    command: ['pnpm', 'test:s3', 'profiles'],
    runs: 2,
    // `certify` already runs this once per CI run; the reliability job does not repeat a Docker journey.
    ci: { runs: 0 }
  },
  {
    id: 'libsql-profile',
    description: 'the on-disk libSQL profile (tiny-project portable integration)',
    kind: 'command',
    command: ['pnpm', 'test:libsql'],
    runs: 3,
    ci: { runs: 2 }
  }
];

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (index === -1) return undefined;
  return args[index].includes('=') ? args[index].split('=')[1] : args[index + 1];
};
const only = flag('--only')?.split(',');
const profile = flag('--profile') ?? 'full';
const runsOverride = flag('--runs') ? Number(flag('--runs')) : undefined;

function playwrightSummary(file) {
  if (!existsSync(file)) return undefined;
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const failures = [];
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            if (result.status !== 'passed' && result.status !== 'skipped') {
              failures.push({
                title: spec.title,
                status: result.status,
                message: String(result.error?.message ?? '')
                  .replace(/\u001b\[[0-9;]*m/g, '')
                  .slice(0, 300)
              });
            }
          }
        }
      }
      walk(suite.suites);
    }
  };
  walk(report.suites);
  return { ...report.stats, failures };
}

// A partial run (--only) refreshes just its journeys in the existing results instead of discarding the rest.
const resultsFile = join(out, 'results.json');
const previous =
  only && existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')).journeys : [];
if (!only) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const results = [];

for (const journey of JOURNEYS) {
  if (only && !only.includes(journey.id)) continue;
  const settings = profile === 'ci' ? (journey.ci ?? {}) : {};
  const runs = runsOverride ?? settings.runs ?? journey.runs;
  const command = [...journey.command];
  if (journey.kind === 'playwright' && settings.args) {
    // The CI profile replaces the repeat/worker arguments of the full profile.
    const keep = command.filter(
      (a) => !a.startsWith('--repeat-each') && !a.startsWith('--workers')
    );
    command.splice(0, command.length, ...keep, ...settings.args);
  }
  if (runs === 0) continue; // not part of this profile
  const record = {
    id: journey.id,
    description: journey.description,
    command: command.join(' '),
    runs: []
  };
  for (let run = 1; run <= runs; run++) {
    const jsonFile = join(out, `${journey.id}-${run}.json`);
    const started = Date.now();
    console.log(`\n[stability] ${journey.id} — run ${run}/${runs}: ${command.join(' ')}`);
    const reporter = journey.kind === 'playwright' ? ['--reporter=line,json'] : [];
    const [bin, ...rest] = command;
    const child = spawnSync(bin, [...rest, ...reporter], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile }
    });
    const summary = journey.kind === 'playwright' ? playwrightSummary(jsonFile) : undefined;
    record.runs.push({
      run,
      passed: child.status === 0 && (summary === undefined || summary.unexpected === 0),
      exitCode: child.status,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      ...(summary && {
        tests: summary.expected + summary.unexpected + summary.flaky,
        unexpected: summary.unexpected,
        flaky: summary.flaky,
        failures: summary.failures
      })
    });
  }
  record.firstAttemptFailures = record.runs.filter((r) => !r.passed).length;
  results.push(record);
}

const environment = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  ci: process.env.CI === 'true',
  profile
};
const merged = [...previous.filter((old) => !results.some((r) => r.id === old.id)), ...results];
writeFileSync(
  resultsFile,
  `${JSON.stringify({ schema: 1, environment, retries: 0, journeys: merged }, null, 2)}\n`
);

console.log('\n[stability] journey                      runs  first-attempt failures  seconds/run');
let failed = 0;
for (const r of results) {
  failed += r.firstAttemptFailures;
  const seconds = r.runs.map((x) => x.seconds).join(', ');
  console.log(
    `[stability] ${r.id.padEnd(28)} ${String(r.runs.length).padStart(4)}  ${String(r.firstAttemptFailures).padStart(22)}  ${seconds}`
  );
}
if (failed > 0) {
  console.error(
    `[stability] ${failed} run(s) failed on their first attempt — see .quality/stability/results.json`
  );
  process.exit(1);
}
console.log('[stability] every run of every journey passed on its first attempt');
