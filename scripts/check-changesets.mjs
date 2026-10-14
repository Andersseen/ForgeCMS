#!/usr/bin/env node
// The "Changeset required" CI check (spec 092/093). Normally `changeset status --since=origin/main`. When that
// fails inside Changesets prerelease mode because this very pull request also contains the prerelease version
// commit (which consumes its own changesets), accept it iff every changeset the PR added is recorded in pre.json.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { changesetsCoveredByPrerelease } from './release-decision.mjs';

const base = process.argv[2] ?? 'origin/main';
const status = spawnSync('pnpm', ['changeset', 'status', `--since=${base}`], { stdio: 'inherit' });
if (status.status === 0) process.exit(0);

const pre = existsSync('.changeset/pre.json')
  ? JSON.parse(readFileSync('.changeset/pre.json', 'utf8'))
  : null;
const diff = spawnSync(
  'git',
  ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', '.changeset'],
  { encoding: 'utf8' }
);
const added = diff.stdout.split('\n').filter(Boolean);
const verdict = changesetsCoveredByPrerelease({
  added,
  preChangesets: pre ? (pre.changesets ?? []) : null
});
if (verdict.ok) {
  console.log(`Changeset check passed through prerelease mode: ${verdict.reason}.`);
  process.exit(0);
}
console.error(`Changeset check failed: ${verdict.reason}.`);
process.exit(1);
