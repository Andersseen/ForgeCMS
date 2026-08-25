#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const packageNamePattern = /^@forge-cms\/[a-z0-9-]+$/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: process.env
  });

  return result;
}

function assertOk(result, description) {
  if (result.status === 0) {
    return;
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  throw new Error(`${description} failed with exit code ${result.status}\n${output}`);
}

function isNotFound(result) {
  return result.status !== 0 && /E404|404 Not Found|is not in this registry/.test(result.stderr);
}

const packages = readdirSync('packages')
  .map((directory) => {
    const packageJsonPath = join('packages', directory, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return {
      directory,
      name: packageJson.name,
      private: packageJson.private === true,
      version: packageJson.version
    };
  })
  .filter((pkg) => !pkg.private)
  .sort((a, b) => a.name.localeCompare(b.name));

for (const pkg of packages) {
  if (!packageNamePattern.test(pkg.name)) {
    throw new Error(`Refusing to publish unexpected package name: ${pkg.name}`);
  }

  const specifier = `${pkg.name}@${pkg.version}`;
  const viewResult = run('npm', ['view', specifier, 'version']);

  if (viewResult.status === 0) {
    console.log(`${specifier} already published`);
    continue;
  }

  if (!isNotFound(viewResult)) {
    assertOk(viewResult, `npm view ${specifier}`);
  }

  if (dryRun) {
    console.log(`${specifier} would be published`);
    continue;
  }

  console.log(`Publishing ${specifier}`);
  const publishResult = run(
    'pnpm',
    ['--filter', pkg.name, 'publish', '--access', 'public', '--no-git-checks', '--provenance'],
    { stdio: 'inherit' }
  );
  assertOk(publishResult, `publish ${specifier}`);
}
