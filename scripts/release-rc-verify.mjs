#!/usr/bin/env node
// Release-candidate publication guards (spec 092, first-publication safety spec 095). Used by
// .github/workflows/release-rc.yml.
//   --phase pre  <expected-version> --snapshot <file>
//        family is exactly the fixed twelve at one `1.0.0-rc.N` equal to the expected version; the registry
//        state of every package is recorded in <file> (JSON). A package may be absent (E404, first
//        publication) or have no `latest` (prerelease-only); existing `latest` tags must be stable and equal.
//   --phase post <expected-version> --snapshot <file>
//        every package exists, `rc` → version, and `latest` is exactly what the PRE snapshot recorded
//        (a package that had none must still have none). Registry propagation is waited out (bounded
//        `--timeout-seconds`, default 1200, every `--interval-seconds`, default 30): only a missing
//        version / `rc` tag is retried; a wrong `rc` or a moved `latest` fails at once. npm assigns `latest` to
//        a package's first version whatever `--tag` says, so `--remove-first-publication-latest` deletes exactly
//        that `latest` (candidate version, package absent before) — never any other tag.
//   --phase finalize <expected-version> --baseline <stable> [--first-publication <a,b>]
//        the same POST check for a run whose snapshot is gone (recovery of an already-published candidate):
//        the snapshot is rebuilt from the stable baseline and the first-published packages. Never publishes, and never
//        touches a tag unless `--remove-first-publication-latest` is passed explicitly.
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertFixedFamily,
  assertPostSnapshot,
  buildPreSnapshot,
  isRcVersion,
  isRegistryNotFound,
  registryStateFromDistTags,
  snapshotFromBaseline,
  verifyPostWithRetry
} from './release-decision.mjs';

const argv = process.argv.slice(2);
const usage =
  'usage: release-rc-verify.mjs --phase pre|post <expected-version> --snapshot <file> | --phase finalize <expected-version> --baseline <stable>';
const phaseIndex = argv.indexOf('--phase');
const optionValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const phase = optionValue('--phase');
const snapshotPath = optionValue('--snapshot');
const valueFlags = [
  '--phase',
  '--snapshot',
  '--baseline',
  '--first-publication',
  '--timeout-seconds',
  '--interval-seconds'
];
const expected = argv.find((arg, i) => !arg.startsWith('--') && !valueFlags.includes(argv[i - 1]));
if (!['pre', 'post', 'finalize'].includes(phase) || !expected) throw new Error(usage);
if (phase !== 'finalize' && !snapshotPath) throw new Error(usage);

const packages = readdirSync('packages')
  .map((directory) => JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8')))
  .filter((json) => json.private !== true)
  .map((json) => ({ name: json.name, version: json.version }));

const version = assertFixedFamily(packages);
if (!isRcVersion(version)) throw new Error(`${version} is not a 1.0.0-rc.N candidate`);
if (version !== expected) throw new Error(`Checked-out version ${version} != expected ${expected}`);

/** Parsed dist-tags, or `null` only for a genuine registry 404. Any other failure throws. */
function distTags(name) {
  const result = spawnSync('npm', ['view', name, 'dist-tags', '--json', '--prefer-online'], {
    encoding: 'utf8',
    timeout: 60_000
  });
  if (result.error)
    throw new Error(`npm view ${name} dist-tags could not run: ${result.error.message}`);
  if (result.status !== 0) {
    if (isRegistryNotFound(`${result.stderr}\n${result.stdout}`)) return null;
    throw new Error(`npm view ${name} dist-tags failed\n${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm view ${name} dist-tags returned invalid JSON: ${result.stdout.slice(0, 200)}`
    );
  }
}

if (phase === 'pre') {
  const states = {};
  for (const pkg of packages) states[pkg.name] = registryStateFromDistTags(distTags(pkg.name));
  const snapshot = buildPreSnapshot(states);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const absent = Object.entries(snapshot.packages).filter(([, state]) => !state.exists);
  console.log(
    `stable baseline ${snapshot.stableBaseline}; ${packages.length - absent.length} existing, ` +
      `${absent.length} not yet published (${absent.map(([name]) => name).join(', ') || 'none'})`
  );
} else {
  const finalize = phase === 'finalize';
  let snapshot;
  if (finalize) {
    const baseline = optionValue('--baseline');
    if (!baseline) throw new Error(usage);
    const first = (optionValue('--first-publication') ?? '').split(',').filter(Boolean);
    snapshot = snapshotFromBaseline(baseline, first);
  } else {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  }
  const number = (flag, fallback) => {
    const raw = optionValue(flag);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${flag} must be a number >= 0`);
    return value;
  };
  const removeFirstPublicationLatest = argv.includes('--remove-first-publication-latest');
  const { attempts } = await verifyPostWithRetry({
    snapshot,
    version,
    observe: () => {
      const observed = {};
      for (const pkg of packages) {
        const tags = distTags(pkg.name);
        observed[pkg.name] = { exists: tags !== null, tags };
      }
      return observed;
    },
    sleep: (ms) => delay(ms),
    now: () => Date.now(),
    timeoutMs: number('--timeout-seconds', 1200) * 1000,
    intervalMs: number('--interval-seconds', 30) * 1000,
    allowFirstPublicationLatest: removeFirstPublicationLatest,
    removeLatest: (name) => removeLatest(name),
    log: (message) => console.log(message)
  });
  console.log(
    `all ${packages.length} packages: rc → ${version}, every existing latest unchanged (${attempts} registry read(s))`
  );
}

/** `npm dist-tag rm <name> latest` — only ever called for a first-published package whose latest is the candidate. */
function removeLatest(name) {
  const result = spawnSync('npm', ['dist-tag', 'rm', name, 'latest'], {
    encoding: 'utf8',
    timeout: 60_000
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm dist-tag rm ${name} latest failed: ${result.error?.message ?? result.stderr}`
    );
  }
}
