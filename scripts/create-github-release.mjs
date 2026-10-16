#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideAggregateRelease,
  assertFixedFamily,
  detectReleaseMode,
  githubReleasePlan,
  assertTagTarget,
  isRcVersion,
  releaseCommit,
  releaseTargetSha
} from './release-decision.mjs';

const dryRun = process.argv.includes('--dry-run');
/** `--mode stable|prerelease` (default stable): the release kind this invocation is allowed to create. */
function readModeArgument(argv) {
  const index = argv.indexOf('--mode');
  const value = index === -1 ? 'stable' : argv[index + 1];
  if (value !== 'stable' && value !== 'prerelease') {
    throw new Error(`--mode must be "stable" or "prerelease" (got ${JSON.stringify(value)})`);
  }
  return value;
}

const expectedMode = readModeArgument(process.argv.slice(2));
const packageNamePattern = /^@forge-cms\/[a-z0-9-]+$/;

function readPublicPackages() {
  return readdirSync('packages')
    .map((directory) => {
      const packageJsonPath = join('packages', directory, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return {
        name: packageJson.name,
        private: packageJson.private === true,
        version: packageJson.version
      };
    })
    .filter((pkg) => !pkg.private)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The public packages as they were at the first parent of the commit being released (the triggering
 * commit, see `releaseCommit`), or `null` when that commit cannot be read — e.g. a depth-1 checkout.
 * The CI release job checks out with `fetch-depth: 2`.
 */
function readFirstParentPackages(commit) {
  const packages = [];
  for (const directory of readdirSync('packages')) {
    const result = spawnSync('git', ['show', `${commit}^1:packages/${directory}/package.json`], {
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      // A package directory that did not exist at the parent is a new package, not an unreadable parent.
      const parent = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${commit}^1`], {
        encoding: 'utf8'
      });
      if (parent.status !== 0) return null;
      continue;
    }
    const packageJson = JSON.parse(result.stdout);
    if (packageJson.private !== true) {
      packages.push({ name: packageJson.name, version: packageJson.version });
    }
  }
  return packages;
}

async function githubFetch(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN is required to create a GitHub release.');
  }

  const repository = process.env.GITHUB_REPOSITORY;

  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required to create a GitHub release.');
  }

  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {})
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return response.json();
}

const packages = readPublicPackages();

if (packages.length === 0) {
  throw new Error('No public packages found under packages/.');
}

for (const pkg of packages) {
  if (!packageNamePattern.test(pkg.name)) {
    throw new Error(`Refusing to release unexpected package name: ${pkg.name}`);
  }
}

// The stable path must never create a prerelease's release (or the reverse): the mode is explicit.
const actualMode = detectReleaseMode(packages);
if (actualMode !== expectedMode) {
  throw new Error(
    `Refusing to create a ${expectedMode} GitHub release: public packages are in ${actualMode} mode.`
  );
}

// Stable: only the commit that introduced this version may carry `vX.Y.Z` (spec 072 §9).
// Prerelease: the manual RC workflow *is* the explicit act, run on the candidate SHA it was given, so the
// first-parent test does not apply; the existing-release check below keeps it idempotent.
let version;
if (expectedMode === 'prerelease') {
  version = assertFixedFamily(packages);
  if (!isRcVersion(version)) throw new Error(`${version} is not a 1.0.0-rc.N release candidate`);
} else {
  const decision = decideAggregateRelease({
    head: packages,
    base: readFirstParentPackages(releaseCommit(process.env))
  });
  console.log(`Aggregate release decision: ${decision.reason}`);
  if (!decision.create) {
    process.exit(0);
  }
  version = decision.version;
}

const { tagName, prerelease } = githubReleasePlan(version);
const targetCommitish = releaseTargetSha(process.env);

if (!targetCommitish) {
  throw new Error('GITHUB_SHA (or RELEASE_TARGET_SHA) is required to create a GitHub release.');
}

const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.version}`).join('\n');
const body = prerelease
  ? `ForgeCMS release candidate ${version}, published to npm under the \`rc\` dist-tag (npm \`latest\` is unchanged).\n\n${packageList}\n\nSee docs/1.0-RC-NOTES.md.`
  : `Published ForgeCMS packages to npm as ${version}.\n\n${packageList}`;

if (dryRun) {
  console.log(`Would ensure GitHub release ${tagName} at ${targetCommitish}`);
  process.exit(0);
}

const existingRelease = await githubFetch(`/releases/tags/${encodeURIComponent(tagName)}`);

if (existingRelease) {
  if (prerelease) {
    const tag = await githubFetch(`/git/ref/tags/${encodeURIComponent(tagName)}`);
    assertTagTarget(tagName, tag?.object?.sha, targetCommitish);
  }
  console.log(`GitHub release ${tagName} already exists: ${existingRelease.html_url}`);
  process.exit(0);
}

const existingTag = await githubFetch(`/git/ref/tags/${encodeURIComponent(tagName)}`);

if (!existingTag) {
  await githubFetch('/git/refs', {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: targetCommitish
    })
  });
  console.log(`Created tag ${tagName}`);
}

const release = await githubFetch('/releases', {
  method: 'POST',
  body: JSON.stringify({
    tag_name: tagName,
    target_commitish: targetCommitish,
    name: `ForgeCMS ${tagName}`,
    body,
    draft: false,
    prerelease
  })
});

console.log(`Created GitHub release ${tagName}: ${release.html_url}`);
