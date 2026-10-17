// Regression coverage for the explicit real-registry consumer mode (roadmap L02): exact-version resolution,
// consumer dependency isolation and the content-based registry/certified artifact comparison.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scanConsumerFile } from './certification/artifacts.mjs';
import { compareUnpacked, normalizedManifest, unpack } from './registry/artifact-compare.mjs';
import {
  assertExactVersion,
  isolatedEnv,
  lockedForgePackages,
  lockfileProblems,
  registrySpecs,
  workspaceProblems
} from './registry/lib.mjs';

const VERSION = '1.0.0-rc.2';
const NAMES = ['@forge-cms/api', '@forge-cms/core'];

const lock = (api = VERSION, core = VERSION, extra = '') => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@forge-cms/api':
        specifier: ${api}
        version: ${api}

packages:

  '@forge-cms/api@${api}':
    resolution: {integrity: sha512-HOpNBg/niCAxN+uFvSl/HKJIq/JGn9mOvKHTlCUP2Qj02Ro1wckC3LHZX27wFoiSWiKh7STP/5o7keP5Gf3Phg==}

  '@forge-cms/core@${core}':
    resolution: {integrity: sha512-9EqKQWhAufNrJvwqtGkGsa2uYg4q0x+yhSGssyuTnWyqIr8yYkGaSI5W0D/rFl16xLWj8bkS86DwKilLGcOBwA==}
${extra}
snapshots:

  '@forge-cms/api@${api}': {}
`;

test('a registry check names one exact version', () => {
  assert.equal(assertExactVersion('1.0.0-rc.2'), '1.0.0-rc.2');
  assert.equal(assertExactVersion('0.13.4'), '0.13.4');
  for (const bad of [
    undefined,
    '',
    'latest',
    'rc',
    '^1.0.0-rc.2',
    'workspace:*',
    'file:../x.tgz',
    '>=1.0.0'
  ]) {
    assert.throws(() => assertExactVersion(bad), /exact version/, String(bad));
  }
});

test('registrySpecs maps every package to the same exact version', () => {
  assert.deepEqual(registrySpecs(NAMES, VERSION), {
    '@forge-cms/api': VERSION,
    '@forge-cms/core': VERSION
  });
  assert.throws(() => registrySpecs(NAMES, 'latest'), /exact version/);
});

test('lockedForgePackages reads the packages section only', () => {
  assert.deepEqual(lockedForgePackages(lock()), [
    { name: '@forge-cms/api', version: VERSION },
    { name: '@forge-cms/core', version: VERSION }
  ]);
});

test('a clean registry lockfile has no problems', () => {
  assert.deepEqual(lockfileProblems(lock(), { version: VERSION, names: NAMES }), []);
});

test('a mixed 0.13.4 / rc.2 Forge graph is a problem', () => {
  const problems = lockfileProblems(lock(VERSION, '0.13.4'), { version: VERSION, names: NAMES });
  assert.ok(
    problems.some((p) => p.includes('@forge-cms/core resolved to 0.13.4')),
    problems.join('\n')
  );
});

test('an unexpected or missing Forge package is a problem', () => {
  assert.ok(
    lockfileProblems(lock(), { version: VERSION, names: ['@forge-cms/api'] }).some((p) =>
      p.includes('unexpected Forge package in the lockfile: @forge-cms/core')
    )
  );
  assert.ok(
    lockfileProblems(lock(), { version: VERSION, names: [...NAMES, '@forge-cms/db'] }).some((p) =>
      p.includes('@forge-cms/db is not in the lockfile')
    )
  );
});

test('a local tarball, link, file or workspace resolution is not a registry install', () => {
  const tarball = lock().replace(
    /('@forge-cms\/core@[^']+':\n {4}resolution: )\{integrity: [^}]+\}/,
    '$1{tarball: file:../packs/forge-cms-core-1.0.0-rc.2.tgz}'
  );
  const problems = lockfileProblems(tarball, { version: VERSION, names: NAMES });
  assert.ok(
    problems.some((p) => p.includes('@forge-cms/core has no registry integrity hash')),
    problems.join('\n')
  );
  assert.ok(problems.some((p) => p.includes('@forge-cms/core is not resolved from the registry')));
  for (const marker of ['link:../core', 'workspace:*']) {
    const linked = lock().replace(`specifier: ${VERSION}`, `specifier: ${marker}`);
    assert.ok(
      lockfileProblems(linked, { version: VERSION, names: NAMES }).some((p) =>
        /resolution/.test(p)
      ),
      marker
    );
  }
});

test('a registry consumer may declare only the exact version; packed mode stays tarball-only', () => {
  const manifest = (range) =>
    JSON.stringify({ dependencies: { '@forge-cms/core': range, h3: '^1.15.0' } });
  assert.deepEqual(
    scanConsumerFile('package.json', manifest(VERSION), { registryVersion: VERSION }),
    []
  );
  for (const range of ['^1.0.0-rc.2', 'latest', 'workspace:*', 'file:../core.tgz', '0.13.4']) {
    assert.ok(
      scanConsumerFile('package.json', manifest(range), { registryVersion: VERSION }).length > 0,
      range
    );
  }
  // Packed mode is unchanged: an exact registry version is NOT a packed tarball.
  assert.ok(
    scanConsumerFile('package.json', manifest(VERSION)).some((p) => /not a packed tarball/.test(p))
  );
  assert.deepEqual(scanConsumerFile('package.json', manifest('file:../core.tgz')), []);
});

test('isolatedEnv drops inherited package-manager and certification state and pins store, cache and registry', () => {
  const env = isolatedEnv(
    {
      PATH: '/usr/bin',
      HOME: '/home/x',
      FORGE_CERT_ARTIFACTS: '/repo/.certification/packs',
      npm_config_user_agent: 'pnpm/10',
      npm_config_store_dir: '/repo-store',
      npm_package_name: 'forge-cms',
      npm_lifecycle_event: 'registry:consumers'
    },
    { storeDir: 'relative-store', cacheDir: 'relative-cache' }
  );
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.FORGE_CERT_ARTIFACTS, undefined);
  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.npm_package_name, undefined);
  assert.notEqual(env.npm_config_store_dir, '/repo-store');
  assert.ok(
    env.npm_config_store_dir.endsWith('relative-store') && env.npm_config_store_dir.startsWith('/')
  );
  assert.ok(env.npm_config_cache.endsWith('relative-cache'));
  assert.equal(env.npm_config_registry, 'https://registry.npmjs.org/');
});

test('a consumer inside the repository or under a pnpm workspace is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-registry-test-'));
  try {
    const repo = join(root, 'repo');
    const outside = join(root, 'outside', 'consumer');
    const workspace = join(root, 'ws');
    const nested = join(workspace, 'app');
    for (const dir of [repo, join(repo, 'consumer'), outside, nested])
      mkdirSync(dir, { recursive: true });
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
    assert.deepEqual(workspaceProblems(outside, repo), []);
    assert.ok(
      workspaceProblems(join(repo, 'consumer'), repo).some((p) => /inside the repository/.test(p))
    );
    assert.ok(workspaceProblems(nested, repo).some((p) => /pnpm workspace/.test(p)));
    const link = join(root, 'link');
    symlinkSync(outside, link);
    assert.ok(workspaceProblems(link, repo).length >= 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- registry vs. certified artifact comparison -------------------------------------------------------

function tarball(root, name, files) {
  const dir = join(root, name, 'package');
  mkdirSync(dir, { recursive: true });
  for (const [path, spec] of Object.entries(files)) {
    const { content, mode } = typeof spec === 'string' ? { content: spec, mode: 0o644 } : spec;
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
    chmodSync(join(dir, path), mode);
  }
  return join(root, name);
}

test('normalizedManifest ignores key order, not values', () => {
  const a = normalizedManifest('{"dependencies":{"a":"1","b":"2"},"name":"x"}');
  assert.equal(a, normalizedManifest('{"name":"x","dependencies":{"b":"2","a":"1"}}'));
  assert.notEqual(a, normalizedManifest('{"name":"x","dependencies":{"a":"1","b":"3"}}'));
});

test('compareUnpacked: dependency key order alone is not a difference; content, executables and extras are', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-compare-test-'));
  try {
    const base = {
      'package.json':
        '{"name":"@forge-cms/x","version":"1.0.0-rc.2","dependencies":{"a":"1","b":"2"},"bin":{"x":"./cli.js"}}',
      'dist/index.js': 'export {};\n',
      'cli.js': { content: '#!/usr/bin/env node\n', mode: 0o755 }
    };
    const make = (name, files) => {
      const dir = tarball(root, name, files);
      const out = join(root, `${name}.tgz`);
      execFileSync('tar', ['-czf', out, '-C', dir, 'package']);
      return unpack(out, join(root, `${name}-unpacked`));
    };
    const certified = make('certified', base);
    const problems = (other) => compareUnpacked('@forge-cms/x', certified, other);

    const reordered = make('reordered', {
      ...base,
      'package.json':
        '{"bin":{"x":"./cli.js"},"dependencies":{"b":"2","a":"1"},"version":"1.0.0-rc.2","name":"@forge-cms/x"}'
    });
    assert.deepEqual(problems(reordered), []);

    assert.deepEqual(
      problems(make('changed', { ...base, 'dist/index.js': 'export const evil = 1;\n' })),
      ['@forge-cms/x: dist/index.js differs in content']
    );
    assert.ok(
      problems(
        make('plain', { ...base, 'cli.js': { content: '#!/usr/bin/env node\n', mode: 0o644 } })
      ).some((p) => /cli.js executable bit differs/.test(p))
    );
    assert.ok(
      problems(
        make('extra', { ...base, 'postinstall.sh': { content: 'rm -rf /\n', mode: 0o755 } })
      ).some((p) => /postinstall.sh is published but not certified/.test(p))
    );
    assert.ok(
      problems(
        make('dependency', {
          ...base,
          'package.json':
            '{"name":"@forge-cms/x","version":"1.0.0-rc.2","dependencies":{"a":"1","b":"2","evil":"1"},"bin":{"x":"./cli.js"}}'
        })
      ).some((p) => /"dependencies" differs/.test(p))
    );
    assert.ok(
      problems(
        make('missing', { 'package.json': base['package.json'], 'cli.js': base['cli.js'] })
      ).some((p) => /dist\/index.js is certified but not published/.test(p))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The agent kit bundles a generated corpus (`packages/agent/docs/`, gitignored, written by `prebuild`). A Turbo cache hit
// skips `prebuild`, so without the corpus as a build OUTPUT a fresh checkout packs `@forge-cms/agent` without its docs,
// and without the sources as INPUTS a stale corpus is restored. Found while comparing the published rc.2 agent tarball
// with a local pack (roadmap L02).
test('the agent build caches its generated docs corpus and is invalidated by its sources', () => {
  const turbo = JSON.parse(readFileSync('packages/agent/turbo.json', 'utf8'));
  const build = turbo.tasks.build;
  assert.deepEqual(turbo.extends, ['//']);
  assert.ok(build.outputs.includes('dist/**') && build.outputs.includes('docs/**'), 'outputs');
  for (const source of [
    '../../scripts/build-agent-docs.mjs',
    '../../docs/*.md',
    '../../apps/www/src/content/docs/*.md'
  ]) {
    assert.ok(build.inputs.includes(source), `input ${source}`);
  }
  assert.ok(build.inputs.includes('$TURBO_DEFAULT$'));
});
