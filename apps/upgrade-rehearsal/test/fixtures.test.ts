import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURES_ROOT,
  FIXTURE_VERSIONS,
  loadFixture,
  verifyFixtureIntegrity
} from '../src/fixtures.js';

// Spec 073 §2/§6 — the committed historical fixtures are evidence. This suite is offline and fast (it
// runs in `pnpm test`): every file must match its recorded SHA-256, nothing may be added silently,
// and each fixture must still show the representation its release actually persisted.

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tableSql = (sql: string, table: string) =>
  sql.split('\n').find((line) => line.startsWith(`CREATE TABLE "${table}"`));

describe.each(FIXTURE_VERSIONS)('fixture %s', (version) => {
  it('matches every hash in its manifest and lists every file it contains', () => {
    expect(verifyFixtureIntegrity(version)).toEqual([]);
  });

  it('records where it came from: the published packages of that release', () => {
    const { manifest } = loadFixture(version);
    expect(manifest.forgeVersion).toBe(version);
    expect(manifest.sourceKind).toBe('published-package');
    expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(manifest.packages).sort()).toEqual(
      ['api', 'auth', 'cloudflare', 'core', 'db', 'runtime', 'storage'].map(
        (p) => `@forge-cms/${p}`
      )
    );
    for (const pkg of Object.values(manifest.packages)) {
      expect(pkg.version).toBe(version);
      expect(pkg.integrity).toMatch(/^sha512-/);
    }
    expect(manifest.generatedOn).toEqual(['libsql', 'd1-r2']);
    expect(manifest.profilesIdentical).toBe(true);
  });

  it('stays importable by D1 (no transaction statements) and tiny enough for git', () => {
    const { databaseSql, objects } = loadFixture(version);
    expect(databaseSql).not.toMatch(/^\s*(BEGIN|COMMIT|END)\b/im);
    expect(databaseSql.length).toBeLessThan(64 * 1024);
    for (const object of objects) expect(object.size).toBeLessThan(1024);
  });

  it('detects a changed byte and an unlisted file without regenerating anything', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-fixture-tamper-'));
    scratch.push(root);
    cpSync(join(FIXTURES_ROOT, version), join(root, version), { recursive: true });
    appendFileSync(join(root, version, 'database.sql'), '-- edited\n');
    writeFileSync(join(root, version, 'storage', 'extra.bin'), 'x');
    const problems = verifyFixtureIntegrity(version, root);
    expect(problems.some((p) => p.startsWith('database.sql: expected sha256:'))).toBe(true);
    expect(problems).toContain('storage/extra.bin is not listed in manifest.files');
  });
});

describe('historical representations are what each release persisted (spec 073 §3, §36)', () => {
  it('0.4.0: no bootstrap claim, no _sessionVersion, patch-shaped history, app-written object with metadata', () => {
    const { databaseSql, manifest, objects } = loadFixture('0.4.0');
    expect(tableSql(databaseSql, 'users')).not.toContain('_sessionVersion');
    expect(tableSql(databaseSql, '_versions_posts')).not.toContain('snapshotFormat');
    for (const table of ['_forge_bootstrap', '_forge_storage_intents', '_forge_schema']) {
      expect(tableSql(databaseSql, table)).toBeUndefined();
    }
    expect(tableSql(databaseSql, '_forge_api_keys')).toBeDefined();
    expect(databaseSql).toContain(`'{"title":"Hello Forge, revised"}'`);
    expect(tableSql(databaseSql, 'posts')).not.toContain('"summary"');
    expect(manifest.features.localized).toBe(false);
    expect(objects.find((o) => o.key === 'media/manual/brochure.pdf')?.metadata).toEqual({
      source: 'fixture',
      owner: 'user_editor'
    });
  });

  it('0.6.0: bootstrap claim, _sessionVersion, full snapshots, intents table, localized values', () => {
    const { databaseSql } = loadFixture('0.6.0');
    expect(tableSql(databaseSql, 'users')).toContain('"_sessionVersion" REAL');
    expect(tableSql(databaseSql, '_versions_posts')).toContain('"snapshotFormat" TEXT');
    expect(tableSql(databaseSql, '_forge_bootstrap')).toBeDefined();
    expect(tableSql(databaseSql, '_forge_storage_intents')).toBeDefined();
    expect(tableSql(databaseSql, '_forge_schema')).toBeUndefined();
    expect(databaseSql).toContain(`'{"en":"Hello","es":"Hola"}'`);
  });

  it('0.8.0: an M01 baseline (_forge_schema) exists, a migration ledger does not', () => {
    const { databaseSql, manifest } = loadFixture('0.8.0');
    expect(tableSql(databaseSql, '_forge_schema')).toBeDefined();
    expect(manifest.counts['_forge_schema']).toBeGreaterThan(0);
  });

  it('no fixture contains a table its release did not create', () => {
    for (const version of FIXTURE_VERSIONS) {
      expect(tableSql(loadFixture(version).databaseSql, '_forge_migrations')).toBeUndefined();
    }
  });
});
