#!/usr/bin/env node
// Release-candidate publication guards (spec 092). Used by .github/workflows/release-rc.yml.
//   --phase pre   <expected-version>   family is exactly the fixed twelve at one `1.0.0-rc.N` equal to
//                                      the expected version; npm `latest` is stable; prints `latest`.
//   --phase post  <expected-version> <latest-before>
//                                      every package has the version, `rc` → version, `latest` unchanged.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFixedFamily, assertLatestSafe, isRcVersion, RC_TAG } from './release-decision.mjs';

const [, , flag, phase, expected, latestBefore] = process.argv;
if (flag !== '--phase' || (phase !== 'pre' && phase !== 'post') || !expected) {
  throw new Error(
    'usage: release-rc-verify.mjs --phase pre|post <expected-version> [latest-before]'
  );
}

const packages = readdirSync('packages')
  .map((directory) => JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8')))
  .filter((json) => json.private !== true)
  .map((json) => ({ name: json.name, version: json.version }));

const version = assertFixedFamily(packages);
if (!isRcVersion(version)) throw new Error(`${version} is not a 1.0.0-rc.N candidate`);
if (version !== expected) throw new Error(`Checked-out version ${version} != expected ${expected}`);

function distTags(name) {
  const result = spawnSync('npm', ['view', name, 'dist-tags', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`npm view ${name} dist-tags failed\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

if (phase === 'pre') {
  const latests = new Set();
  for (const pkg of packages) {
    const latest = distTags(pkg.name).latest;
    assertLatestSafe(latest);
    latests.add(latest);
  }
  if (latests.size !== 1)
    throw new Error(`npm "latest" differs across the family: ${[...latests]}`);
  console.log([...latests][0]);
} else {
  if (!latestBefore) throw new Error('--phase post requires the latest-before value');
  for (const pkg of packages) {
    const tags = distTags(pkg.name);
    assertLatestSafe(latestBefore, tags.latest);
    if (tags[RC_TAG] !== version) {
      throw new Error(`${pkg.name}: "${RC_TAG}" is ${tags[RC_TAG]}, expected ${version}`);
    }
  }
  console.error(
    `all ${packages.length} packages: ${RC_TAG} → ${version}, latest unchanged (${latestBefore})`
  );
}
