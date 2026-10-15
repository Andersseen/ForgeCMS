// Spec 095: first-publication registry safety for scripts/release-rc-verify.mjs.
// Spawns the real script in a sandbox with a fake `npm`; never contacts the real registry.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PUBLIC_FAMILY, isRegistryNotFound } from './release-decision.mjs';

const RC = '1.0.0-rc.1';
const AGENT = '@forge-cms/agent';
const STABLE = '0.13.4';

const E404 = { code: 'E404', stderr: 'npm error code E404\nnpm error 404 Not Found' };
const stable = (latest = STABLE, extra = {}) => ({ tags: { latest, ...extra } });

/** Registry fixture: name → { tags } | { code, stderr } | { stdout } (raw). */
function allStable(overrides = {}) {
  const registry = {};
  for (const name of PUBLIC_FAMILY) registry[name] = name === AGENT ? E404 : stable();
  return { ...registry, ...overrides };
}
const published = (latest = STABLE) => ({ tags: { latest, rc: RC } });
const firstPublished = { tags: { rc: RC } };

function sandbox(registry, { version = RC, mismatch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-rcverify-'));
  PUBLIC_FAMILY.forEach((name, i) => {
    const pkgDir = join(dir, 'packages', name.split('/')[1]);
    mkdirSync(pkgDir, { recursive: true });
    const v = mismatch && i === 0 ? '1.0.0-rc.0' : version;
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: v }));
  });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry));
  writeFileSync(join(dir, 'npm-calls.log'), '');
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(join(dir, 'npm-calls.log'))}, process.argv.slice(2).join(' ') + '\\n');
const entry = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, 'registry.json'))}, 'utf8'))[process.argv[3]];
if (!entry) { process.stderr.write('npm error code E404\\nnpm error 404 Not Found\\n'); process.exit(1); }
if (entry.code) { process.stderr.write(entry.stderr); process.exit(1); }
process.stdout.write(entry.stdout ?? JSON.stringify(entry.tags));
`
  );
  chmodSync(join(bin, 'npm'), 0o755);
  return { dir, bin, snapshot: join(dir, 'pre.json') };
}

function run(box, phase, version = RC) {
  return spawnSync(
    process.execPath,
    [
      resolve('scripts/release-rc-verify.mjs'),
      '--phase',
      phase,
      version,
      '--snapshot',
      box.snapshot
    ],
    {
      cwd: box.dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}` }
    }
  );
}

/** PRE with `before` registry, then POST with `after` registry (same sandbox, same snapshot file). */
function preThenPost(before, after) {
  const box = sandbox(before);
  const pre = run(box, 'pre');
  if (pre.status !== 0) return { pre, box };
  writeFileSync(join(box.dir, 'registry.json'), JSON.stringify(after));
  return { pre, post: run(box, 'post'), box };
}

describe('release-rc-verify --phase pre', () => {
  it('1. all twelve existing with stable latest passes', () => {
    const registry = {};
    for (const name of PUBLIC_FAMILY) registry[name] = stable();
    const box = sandbox(registry);
    const pre = run(box, 'pre');
    assert.equal(pre.status, 0, pre.stderr);
  });

  it('2/11. eleven stable + a genuine E404 package passes; snapshot records it as absent', () => {
    const box = sandbox(allStable());
    const pre = run(box, 'pre');
    assert.equal(pre.status, 0, pre.stderr);
    const snapshot = JSON.parse(readFileSync(box.snapshot, 'utf8'));
    assert.equal(snapshot.stableBaseline, STABLE);
    assert.deepEqual(snapshot.packages[AGENT], { exists: false, latest: null });
    assert.deepEqual(snapshot.packages['@forge-cms/core'], { exists: true, latest: STABLE });
    assert.equal(Object.keys(snapshot.packages).length, 12);
  });

  it('3. eleven stable + a prerelease-only package (no latest) passes', () => {
    const box = sandbox(allStable({ [AGENT]: firstPublished }));
    assert.equal(run(box, 'pre').status, 0);
    assert.deepEqual(JSON.parse(readFileSync(box.snapshot, 'utf8')).packages[AGENT], {
      exists: true,
      latest: null
    });
  });

  it('4. partially published candidate passes (resumable)', () => {
    const box = sandbox(
      allStable({
        '@forge-cms/core': published(),
        '@forge-cms/db': stable(),
        [AGENT]: firstPublished
      })
    );
    assert.equal(run(box, 'pre').status, 0);
  });

  it('5. two different stable latest versions fail', () => {
    const box = sandbox(allStable({ '@forge-cms/runtime': stable('0.13.3') }));
    const pre = run(box, 'pre');
    assert.notEqual(pre.status, 0);
    assert.match(pre.stderr, /differs across the family/);
  });

  it('6. a prerelease under latest fails', () => {
    const box = sandbox(allStable({ '@forge-cms/core': stable(RC) }));
    assert.notEqual(run(box, 'pre').status, 0);
  });

  it('7. malformed latest fails', () => {
    for (const bad of ['not-semver', '1.0']) {
      const box = sandbox(allStable({ '@forge-cms/core': stable(bad) }));
      assert.notEqual(run(box, 'pre').status, 0, bad);
    }
    const box = sandbox(allStable({ '@forge-cms/core': { stdout: '{"latest":42}' } }));
    assert.notEqual(run(box, 'pre').status, 0);
  });

  it('requires at least one package to establish a stable baseline', () => {
    const registry = {};
    for (const name of PUBLIC_FAMILY) registry[name] = E404;
    assert.notEqual(run(sandbox(registry), 'pre').status, 0);
  });

  it('13/14. network and permission failures are never "absent"', () => {
    for (const stderr of [
      'npm error code ENOTFOUND\nnpm error network request failed',
      'npm error code E403\nnpm error 403 Forbidden',
      'npm error code E401\nnpm error Unauthorized',
      'npm error code ETIMEDOUT'
    ]) {
      const box = sandbox(allStable({ [AGENT]: { code: 'X', stderr } }));
      assert.notEqual(run(box, 'pre').status, 0, stderr);
    }
  });

  it('15. invalid registry JSON fails', () => {
    for (const stdout of ['<html>oops</html>', '', '[]', '"x"']) {
      const box = sandbox(allStable({ '@forge-cms/core': { stdout } }));
      assert.notEqual(run(box, 'pre').status, 0, stdout);
    }
  });

  it('16. a family version mismatch fails before any registry call', () => {
    const box = sandbox(allStable(), { mismatch: true });
    assert.notEqual(run(box, 'pre').status, 0);
    assert.equal(readFileSync(join(box.dir, 'npm-calls.log'), 'utf8'), '');
    assert.equal(existsSync(box.snapshot), false);
  });

  it('a checked-out version different from the expected one fails', () => {
    const box = sandbox(allStable());
    assert.notEqual(run(box, 'pre', '1.0.0-rc.2').status, 0);
  });
});

describe('release-rc-verify --phase post', () => {
  const afterAll = (agent = firstPublished, overrides = {}) => {
    const registry = {};
    for (const name of PUBLIC_FAMILY) registry[name] = name === AGENT ? agent : published();
    return { ...registry, ...overrides };
  };

  it('first publication: rc everywhere, stable latest untouched, agent has no latest → passes', () => {
    const { pre, post } = preThenPost(allStable(), afterAll());
    assert.equal(pre.status, 0, pre.stderr);
    assert.equal(post.status, 0, post.stderr);
  });

  it('partial then resumed publication passes', () => {
    const partial = allStable({ '@forge-cms/core': published(), [AGENT]: firstPublished });
    const { pre, post } = preThenPost(partial, afterAll());
    assert.equal(pre.status, 0, pre.stderr);
    assert.equal(post.status, 0, post.stderr);
  });

  it('8. missing rc tag fails', () => {
    const { post } = preThenPost(
      allStable(),
      afterAll(firstPublished, { '@forge-cms/db': stable() })
    );
    assert.notEqual(post.status, 0);
    assert.match(post.stderr, /"rc" is undefined/);
  });

  it('9. wrong rc version fails', () => {
    const wrong = { tags: { latest: STABLE, rc: '1.0.0-rc.0' } };
    const { post } = preThenPost(allStable(), afterAll(firstPublished, { '@forge-cms/db': wrong }));
    assert.notEqual(post.status, 0);
  });

  it('10. a first-published package that gets latest → RC fails', () => {
    const { post } = preThenPost(allStable(), afterAll({ tags: { rc: RC, latest: RC } }));
    assert.notEqual(post.status, 0);
    assert.match(post.stderr, /"latest" moved/);
  });

  it('an existing stable latest that moved (to anything) fails', () => {
    for (const moved of [RC, '0.13.5']) {
      const { post } = preThenPost(
        allStable(),
        afterAll(firstPublished, { '@forge-cms/api': { tags: { latest: moved, rc: RC } } })
      );
      assert.notEqual(post.status, 0, moved);
    }
  });

  it('a stable latest that vanished fails', () => {
    const { post } = preThenPost(
      allStable(),
      afterAll(firstPublished, { '@forge-cms/api': { tags: { rc: RC } } })
    );
    assert.notEqual(post.status, 0);
  });

  it('12. E404 after publication fails (every package must exist)', () => {
    const { post } = preThenPost(allStable(), afterAll(E404));
    assert.notEqual(post.status, 0);
    assert.match(post.stderr, /not found in the registry after publication/);
  });

  it('13/14/15. network, 403 and invalid JSON fail', () => {
    for (const bad of [
      { code: 'X', stderr: 'npm error code ENOTFOUND' },
      { code: 'X', stderr: 'npm error code E403 403 Forbidden' },
      { stdout: 'garbage' }
    ]) {
      const { post } = preThenPost(allStable(), afterAll(bad));
      assert.notEqual(post.status, 0);
    }
  });

  it('fails without a readable PRE snapshot', () => {
    const box = sandbox(afterAll());
    assert.notEqual(run(box, 'post').status, 0);
  });
});

describe('isRegistryNotFound', () => {
  it('recognises genuine absence only', () => {
    assert.equal(isRegistryNotFound('npm error code E404'), true);
    assert.equal(isRegistryNotFound("'@x/y@*' is not in this registry."), true);
    assert.equal(isRegistryNotFound('npm error code E403 Forbidden'), false);
    assert.equal(isRegistryNotFound('ENOTFOUND registry.npmjs.org'), false);
  });
});
