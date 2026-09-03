#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
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

const versions = new Set(packages.map((pkg) => pkg.version));

if (versions.size !== 1) {
  const summary = packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
  throw new Error(`Expected all public packages to share one fixed version. Found: ${summary}`);
}

const version = packages[0]?.version;

if (!version) {
  throw new Error('Could not determine package version.');
}

const tagName = `v${version}`;
const targetCommitish = process.env.GITHUB_SHA;

if (!targetCommitish) {
  throw new Error('GITHUB_SHA is required to create a GitHub release.');
}

const packageList = packages.map((pkg) => `- ${pkg.name}@${pkg.version}`).join('\n');
const body = `Published ForgeCMS packages to npm as ${version}.\n\n${packageList}`;

if (dryRun) {
  console.log(`Would ensure GitHub release ${tagName} at ${targetCommitish}`);
  process.exit(0);
}

const existingRelease = await githubFetch(`/releases/tags/${encodeURIComponent(tagName)}`);

if (existingRelease) {
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
    prerelease: false
  })
});

console.log(`Created GitHub release ${tagName}: ${release.html_url}`);
