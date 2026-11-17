// Password work-factor cost on local workerd and on Node (spec 105). `pnpm bench:password-hash`.
//
// Workers bill CPU time and workerd freezes its own clocks during execution, so the cost is measured from
// outside: a throwaway Worker runs exactly one PBKDF2-HMAC-SHA256 derivation per request (Forge's login
// work), served by `wrangler dev`; the median request time minus the median of an empty request is the
// derivation's cost. Node is measured in-process with `performance.now()`. Local hardware is usually
// faster than Cloudflare's edge, so the numbers are lower bounds — compare them against your plan's CPU
// limit (Free: 10 ms per request) and confirm on a staging deployment.
//
// Usage: node scripts/quality/password-hash-bench.mjs [iterations …]   (default: 100000 310000 600000)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const candidates = process.argv.slice(2).map(Number);
const ITERATIONS = candidates.length > 0 ? candidates : [100_000, 310_000, 600_000];
const SAMPLES = 15;
const PORT = 8799;

const WORKER = `export default {
  async fetch(request) {
    const iterations = Number(new URL(request.url).searchParams.get('i') ?? 0);
    if (iterations === 0) return new Response('noop');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('correct horse battery staple'), 'PBKDF2', false, ['deriveBits']);
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
    return new Response('ok');
  }
};
`;

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function nodeCost(iterations) {
  const derive = async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('correct horse battery staple'),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  };
  await derive();
  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = performance.now();
    await derive();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

async function requestTime(query) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${PORT}/?${query}`);
  await response.text();
  if (!response.ok) throw new Error(`worker answered ${response.status} for ${query}`);
  return performance.now() - started;
}

async function workerdCosts() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pbkdf2-bench-'));
  writeFileSync(join(dir, 'worker.js'), WORKER);
  // The newest compatibility date every supported Wrangler accepts is not needed: PBKDF2 has no flag.
  writeFileSync(
    join(dir, 'wrangler.toml'),
    'name = "forge-pbkdf2-bench"\nmain = "worker.js"\ncompatibility_date = "2026-01-01"\n'
  );
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      join(dir, 'wrangler.toml'),
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await requestTime('i=0');
        break;
      } catch {
        if (attempt > 60) throw new Error(`wrangler dev did not start:\n${output}`);
        await sleep(500);
      }
    }
    const sample = async (query) => {
      await requestTime(query);
      const times = [];
      for (let i = 0; i < SAMPLES; i += 1) times.push(await requestTime(query));
      return median(times);
    };
    const baseline = await sample('i=0');
    const costs = new Map();
    for (const iterations of ITERATIONS) {
      costs.set(iterations, (await sample(`i=${iterations}`)) - baseline);
    }
    return costs;
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}

const workerd = await workerdCosts();
const rows = [];
for (const iterations of ITERATIONS) {
  rows.push({
    iterations,
    'workerd (ms)': Number(workerd.get(iterations)?.toFixed(1)),
    'node (ms)': Number((await nodeCost(iterations)).toFixed(1)),
    'fits Workers Free (10 ms)': (workerd.get(iterations) ?? Infinity) < 10 ? 'locally yes' : 'no'
  });
}
console.log(
  `PBKDF2-HMAC-SHA256 login cost, median of ${SAMPLES} (local hardware: lower bounds for the edge)`
);
console.table(rows);
