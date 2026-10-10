import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ARTIFACTS_ENV,
  MANIFEST_FILE,
  PUBLIC_PACKAGES,
  exportTargets,
  inspectPackedPackage,
  loadArtifacts,
  resolveArtifacts,
  scanConsumerFile,
  sha256
} from './certification/artifacts.mjs';

const good = () => ({
  expectedName: '@forge-cms/runtime',
  alignedVersion: '1.2.3',
  pkg: {
    name: '@forge-cms/runtime',
    version: '1.2.3',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    dependencies: { '@forge-cms/core': '1.2.3' },
    repository: { directory: 'packages/runtime' }
  },
  files: ['README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts']
});

test('the public package list is the eleven-package fixed family', () => {
  assert.equal(PUBLIC_PACKAGES.length, 11);
  assert.equal(new Set(PUBLIC_PACKAGES).size, 11);
});

test('exportTargets collects every string leaf of an exports map', () => {
  assert.deepEqual(
    exportTargets({ '.': { types: './a.d.ts', default: './a.js' }, './x': './x.js' }).sort(),
    ['./a.d.ts', './a.js', './x.js']
  );
});

test('a well-formed packed package has no problems (repository metadata may name packages/)', () => {
  assert.deepEqual(inspectPackedPackage(good()), []);
});

test('inspectPackedPackage rejects what a registry consumer cannot use', () => {
  const cases = [
    [(c) => (c.pkg.version = '1.2.4'), /aligned family version/],
    [(c) => (c.pkg.dependencies['@forge-cms/core'] = 'workspace:*'), /cannot resolve/],
    [(c) => (c.pkg.dependencies['@forge-cms/core'] = '1.0.0'), /expected 1\.2\.3/],
    [(c) => (c.pkg.type = 'commonjs'), /"type"/],
    [(c) => c.files.splice(c.files.indexOf('dist/index.js'), 1), /not in the tarball/],
    [(c) => c.files.push('src/index.ts'), /src\//],
    [(c) => c.files.splice(c.files.indexOf('README.md'), 1), /README/],
    [(c) => (c.pkg.exports['.'].default = './src/index.ts'), /points at src\//],
    [(c) => (c.pkg.main = '../../packages/runtime/dist/index.js'), /packages\//]
  ];
  for (const [mutate, expected] of cases) {
    const candidate = good();
    mutate(candidate);
    const problems = inspectPackedPackage(candidate);
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `expected ${expected} in ${JSON.stringify(problems)}`
    );
  }
});

test('scanConsumerFile refuses workspace links, repo reach-ins, aliases and deep imports', () => {
  assert.deepEqual(
    scanConsumerFile(
      'package.json',
      JSON.stringify({ dependencies: { '@forge-cms/core': 'file:/x/core.tgz', vite: '7.1.4' } })
    ),
    []
  );
  assert.equal(
    scanConsumerFile(
      'package.json',
      JSON.stringify({ dependencies: { '@forge-cms/core': 'workspace:*' } })
    ).length,
    2
  );
  assert.equal(
    scanConsumerFile(
      'package.json',
      JSON.stringify({ dependencies: { '@forge-cms/core': '^0.1.0' } })
    ).length,
    1
  );
  assert.equal(
    scanConsumerFile('tsconfig.json', '{"compilerOptions":{"paths":{"@forge-cms/core":["../x"]}}}')
      .length,
    1
  );
  assert.equal(
    scanConsumerFile('src/a.ts', "import x from '../../packages/core/src/index';").length,
    1
  );
  assert.equal(
    scanConsumerFile('src/a.ts', "import x from '@forge-cms/core/dist/index.js';").length,
    1
  );
  assert.equal(
    scanConsumerFile('src/a.ts', "import x from '@forge-cms/angular/server';").length,
    0
  );
  assert.equal(
    scanConsumerFile('src/a.ts', "import x from '@forge-cms/testing/contracts';").length,
    0
  );
  assert.equal(scanConsumerFile('src/a.ts', "import x from '../../../api/runtime';").length, 0);
});

test('a certified artifact set is hash-checked on every load and never silently repacked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cert-test-'));
  const previous = process.env[ARTIFACTS_ENV];
  try {
    const tarball = join(dir, 'forge-cms-core-1.2.3.tgz');
    writeFileSync(tarball, 'original bytes');
    writeFileSync(
      join(dir, MANIFEST_FILE),
      JSON.stringify({
        packages: [
          {
            name: '@forge-cms/core',
            version: '1.2.3',
            file: 'forge-cms-core-1.2.3.tgz',
            sha256: sha256(tarball)
          }
        ]
      })
    );
    assert.equal(loadArtifacts(dir).packages.length, 1);

    process.env[ARTIFACTS_ENV] = dir;
    const [entry] = resolveArtifacts('/nonexistent-fallback', ['@forge-cms/core']);
    assert.equal(entry.path, tarball);
    assert.throws(
      () => resolveArtifacts('/nonexistent-fallback', ['@forge-cms/db']),
      /not part of the artifact set/
    );

    writeFileSync(tarball, 'tampered bytes');
    assert.throws(
      () => resolveArtifacts('/nonexistent-fallback', ['@forge-cms/core']),
      /no longer matches/
    );
  } finally {
    if (previous === undefined) delete process.env[ARTIFACTS_ENV];
    else process.env[ARTIFACTS_ENV] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
