import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRODUCTION_IDENTIFIERS,
  StagingGuardError,
  assertDistinct,
  assertStagingName,
  buildCommands,
  buildManifest,
  compareObject,
  findLeaks,
  keyFileName,
  keysFromSnapshotSql,
  verifyOrigin
} from './staging/staging-lib.mjs';
import { copyObjects, inspectObjects } from './staging/r2-copy-worker.mjs';

// Spec 090 — the staging tooling must be unable to name a production resource.

test('every known production identifier is refused, as is an empty or unprefixed target', () => {
  for (const id of PRODUCTION_IDENTIFIERS)
    assert.throws(() => assertStagingName(id), StagingGuardError);
  for (const bad of ['', '   ', undefined, 'my-staging', 'forge-cms-r03', 'Forge-CMS-R03-X']) {
    assert.throws(() => assertStagingName(bad), StagingGuardError);
  }
  assert.equal(assertStagingName('forge-cms-r03-staging'), 'forge-cms-r03-staging');
});

test('the manifest and every command it builds stay inside the staging prefix', () => {
  const manifest = buildManifest({ suffix: 'a1b2' });
  assert.equal(new Set(manifest.resources.map((r) => r.name)).size, manifest.resources.length);
  const commands = buildCommands(manifest, { commit: 'abc123' });
  const all = [
    ...commands.provision,
    ...commands.secrets,
    ...commands.deploy,
    ...commands.exportD1('x.sql')
  ].flat();
  for (const token of all) {
    for (const id of PRODUCTION_IDENTIFIERS) assert.notEqual(token, id);
  }
  assert.ok(commands.deploy[0].includes('--commit-hash'));
  assert.ok(commands.exportD1('x.sql')[0].includes('--remote'));
  assert.throws(() => buildManifest({ suffix: 'forge-cms' }), StagingGuardError);
  assert.throws(() => commands.importD1('forge-cms', 'x.sql'), StagingGuardError);
});

test('secrets never appear in the planned argv', () => {
  const commands = buildCommands(buildManifest());
  assert.ok(!JSON.stringify(commands).includes('AUTH_SECRET='));
});

test('source and target must differ', () => {
  assert.throws(() => assertDistinct('forge-cms-r03-x', 'forge-cms-r03-x'), StagingGuardError);
  assert.doesNotThrow(() => assertDistinct('forge-cms-r03-x', 'forge-cms-r03-y'));
});

test('required R2 keys come from the snapshot rows, deduplicated and sorted — not from a bucket listing', async () => {
  // Re-create the "export" as SQL text the way `wrangler d1 export` emits it.
  const sql = `
    CREATE TABLE media (id TEXT, _storageKey TEXT);
    CREATE TABLE posts (id TEXT, title TEXT);
    CREATE TABLE avatars (id TEXT, _storageKey TEXT);
    INSERT INTO media VALUES ('1','media/b.png');
    INSERT INTO media VALUES ('2',NULL);
    INSERT INTO media VALUES ('3','media/../weird key é.png');
    INSERT INTO avatars VALUES ('9','media/a.png');
    INSERT INTO avatars VALUES ('8','media/b.png');
    INSERT INTO posts VALUES ('p','x');`;
  assert.deepEqual(await keysFromSnapshotSql(sql), [
    'media/../weird key é.png',
    'media/a.png',
    'media/b.png'
  ]);
  assert.match(keyFileName('media/../x'), /^[0-9a-f]{64}\.bin$/);
});

test('object comparison reports each differing property, and a missing object', () => {
  const base = {
    sha256: 'aa',
    size: 3,
    contentType: 'text/plain',
    customMetadata: { a: '1', b: '2' }
  };
  assert.deepEqual(compareObject(base, { ...base, customMetadata: { b: '2', a: '1' } }), []);
  assert.deepEqual(compareObject(base, { ...base, sha256: 'bb', contentType: 'image/png' }), [
    'sha256',
    'contentType'
  ]);
  assert.deepEqual(compareObject(base, { ...base, customMetadata: {} }), ['customMetadata']);
  assert.deepEqual(compareObject(base, null), ['missing in target']);
});

test('the R2 copy preserves bytes, content type and custom metadata, and reports a missing source key', async () => {
  const store = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      map,
      get: async (k) => {
        const o = map.get(k);
        return o ? { ...o, arrayBuffer: async () => o.bytes.slice(0).buffer } : null;
      },
      put: async (k, bytes, opts) => map.set(k, { bytes: new Uint8Array(bytes), ...opts })
    };
  };
  const source = store({
    'k/1': {
      bytes: new TextEncoder().encode('hello'),
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { owner: 'media:1' }
    }
  });
  const target = store();
  const copied = await copyObjects(source, target, ['k/1', 'k/missing']);
  assert.equal(copied['k/missing'].error, 'missing in source');
  assert.equal(copied['k/1'].size, 5);
  assert.equal(
    copied['k/1'].sha256,
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
  const seen = await inspectObjects(target, ['k/1', 'k/missing']);
  assert.deepEqual(compareObject(copied['k/1'], seen['k/1']), []);
  assert.equal(seen['k/missing'], null);
});

const okFetch =
  (overrides = {}) =>
  async (url) => {
    const path = new URL(url).pathname;
    const table = {
      '/api/content/collections': [200, JSON.stringify({ data: [{ slug: 'posts' }] })],
      '/api/site/posts': [200, JSON.stringify({ data: [] })],
      '/api/account/me': [401, '{"error":"Unauthorized"}'],
      '/api/content/does-not-exist': [404, '{"error":"Not found"}'],
      '/studio/login': [200, '<!doctype html><html></html>'],
      '/': [200, '<!doctype html><html></html>'],
      ...overrides
    };
    const [status, body] = table[path];
    return new Response(body, { status });
  };

test('origin verification refuses production hosts and non-https, passes a healthy staging origin', async () => {
  await assert.rejects(
    verifyOrigin('https://forge-cms.pages.dev', { fetchImpl: okFetch() }),
    StagingGuardError
  );
  await assert.rejects(
    verifyOrigin('https://forge-cms-demo.pages.dev', { fetchImpl: okFetch() }),
    StagingGuardError
  );
  await assert.rejects(
    verifyOrigin('http://forge-cms-r03-staging.pages.dev', { fetchImpl: okFetch() }),
    StagingGuardError
  );
  await assert.rejects(
    verifyOrigin('https://example.com', { fetchImpl: okFetch() }),
    StagingGuardError
  );
  const report = await verifyOrigin('https://forge-cms-r03-staging.pages.dev', {
    fetchImpl: okFetch()
  });
  assert.equal(report.ok, true);
});

test('origin verification fails on a startup 500 and on leaked internals or secret markers', async () => {
  const origin = 'https://forge-cms-r03-staging.pages.dev';
  const broken = await verifyOrigin(origin, {
    fetchImpl: okFetch({ '/api/site/posts': [500, 'boom'] })
  });
  assert.equal(broken.ok, false);
  const leaky = await verifyOrigin(origin, {
    fetchImpl: okFetch({
      '/api/content/does-not-exist': [404, 'D1_ERROR: too many SQL variables MARK_X']
    }),
    secrets: ['MARK_X']
  });
  assert.equal(leaky.ok, false);
  assert.deepEqual(findLeaks('has passwordHash and MARK_X', ['MARK_X']), [
    'passwordHash',
    'MARK_X'
  ]);
});
