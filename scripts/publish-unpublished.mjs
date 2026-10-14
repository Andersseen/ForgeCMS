#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlreadyPublishedError, resolvePublishTag } from './release-decision.mjs';

const dryRun = process.argv.includes('--dry-run');
/** `--tag <name>` / `--tag=<name>`; `undefined` when absent. A bare `--tag` is an error, never "latest". */
function readTagArgument(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tag') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--tag requires a value');
      return value;
    }
    if (arg.startsWith('--tag=')) return arg.slice('--tag='.length);
  }
  return undefined;
}

const requestedTag = readTagArgument(process.argv.slice(2));
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

// Fail closed before any registry call: a prerelease without an explicit non-latest tag, or any
// stable package given a tag, aborts the whole run (spec 092).
const publishTags = new Map(
  packages.map((pkg) => [pkg.name, resolvePublishTag(pkg.version, requestedTag)])
);

for (const pkg of packages) {
  if (!packageNamePattern.test(pkg.name)) {
    throw new Error(`Refusing to publish unexpected package name: ${pkg.name}`);
  }

  const specifier = `${pkg.name}@${pkg.version}`;
  const viewResult = run('npm', ['view', specifier, 'version']);

  if (viewResult.status === 0) {
    console.log(`${specifier} already published`);
    continue;
  } else if (!isNotFound(viewResult)) {
    assertOk(viewResult, `npm view ${specifier}`);
  } else if (dryRun) {
    console.log(`${specifier} would be published`);
    continue;
  } else {
    console.log(`Publishing ${specifier}`);
    const publishResult = run('pnpm', [
      '--filter',
      pkg.name,
      'publish',
      '--access',
      'public',
      '--no-git-checks',
      '--provenance',
      ...(publishTags.get(pkg.name) ? ['--tag', publishTags.get(pkg.name)] : [])
    ]);
    process.stdout.write(publishResult.stdout ?? '');
    process.stderr.write(publishResult.stderr ?? '');
    // Right after `changeset publish`, `npm view` can still answer 404 while a second publish is refused
    // (E409 "previously staged"). That is "already published", not a failure: failing here skipped the
    // GitHub release step of the 0.6.0 and 0.7.0 runs (spec 072 §9).
    if (
      publishResult.status !== 0 &&
      isAlreadyPublishedError(`${publishResult.stdout}\n${publishResult.stderr}`)
    ) {
      console.log(`${specifier} already published (registry had not caught up yet)`);
      continue;
    }
    assertOk(publishResult, `publish ${specifier}`);
  }
}
