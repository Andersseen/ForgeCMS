#!/usr/bin/env node
// Release-candidate publication guards (spec 092, first-publication safety spec 095). Used by
// .github/workflows/release-rc.yml.
//   --phase pre  <expected-version> --snapshot <file>
//        family is exactly the fixed twelve at one `1.0.0-rc.N` equal to the expected version; the registry
//        state of every package is recorded in <file> (JSON). A package may be absent (E404, first
//        publication) or have no `latest` (prerelease-only); existing `latest` tags must be stable and equal.
//   --phase post <expected-version> --snapshot <file>
//        every package exists, `rc` → version, and `latest` is exactly what the PRE snapshot recorded
//        (a package that had none must still have none).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertFixedFamily,
  assertPostSnapshot,
  buildPreSnapshot,
  isRcVersion,
  isRegistryNotFound,
  registryStateFromDistTags
} from './release-decision.mjs';

const argv = process.argv.slice(2);
const usage = 'usage: release-rc-verify.mjs --phase pre|post <expected-version> --snapshot <file>';
const phaseIndex = argv.indexOf('--phase');
const snapshotIndex = argv.indexOf('--snapshot');
const phase = phaseIndex >= 0 ? argv[phaseIndex + 1] : undefined;
const snapshotPath = snapshotIndex >= 0 ? argv[snapshotIndex + 1] : undefined;
const expected = argv.find(
  (arg, i) => !arg.startsWith('--') && i !== phaseIndex + 1 && i !== snapshotIndex + 1
);
if ((phase !== 'pre' && phase !== 'post') || !expected || !snapshotPath) throw new Error(usage);

const packages = readdirSync('packages')
  .map((directory) => JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8')))
  .filter((json) => json.private !== true)
  .map((json) => ({ name: json.name, version: json.version }));

const version = assertFixedFamily(packages);
if (!isRcVersion(version)) throw new Error(`${version} is not a 1.0.0-rc.N candidate`);
if (version !== expected) throw new Error(`Checked-out version ${version} != expected ${expected}`);

/** Parsed dist-tags, or `null` only for a genuine registry 404. Any other failure throws. */
function distTags(name) {
  const result = spawnSync('npm', ['view', name, 'dist-tags', '--json'], {
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
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const observed = {};
  for (const pkg of packages) {
    const tags = distTags(pkg.name);
    observed[pkg.name] = { exists: tags !== null, tags };
  }
  assertPostSnapshot(snapshot, version, observed);
  console.log(`all ${packages.length} packages: rc → ${version}, every existing latest unchanged`);
}
