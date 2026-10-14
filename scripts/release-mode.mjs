#!/usr/bin/env node
// Prints the release mode of the public family at HEAD (`stable` | `prerelease` | `none`) and, in CI,
// writes it to $GITHUB_OUTPUT as `mode=…`. The ordinary main release job publishes only `stable`; a
// prerelease is published solely by the manual release-rc workflow (spec 092).
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectReleaseMode } from './release-decision.mjs';

const packages = readdirSync('packages')
  .map((directory) => JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8')))
  .filter((json) => json.private !== true)
  .map((json) => ({ name: json.name, version: json.version }));

const mode = detectReleaseMode(packages);
const preActive = existsSync(join('.changeset', 'pre.json'));
console.log(`Release mode: ${mode}${preActive ? ' (changesets pre mode active)' : ''}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\npre=${preActive}\n`);
}
