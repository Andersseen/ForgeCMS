import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { isSchemaDriftError } from '@forge-cms/db';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  MANIFEST_FILE,
  requiredStorageKeys,
  restoreObjects,
  verifyBackup,
  writeBackup
} from '../src/backup.js';
import { FIXTURE_VERSIONS, loadFixture, type Fixture } from '../src/fixtures.js';
import {
  coldBackupDatabase,
  createDatabaseFromSql,
  fileUrl,
  openLibsqlInstallation,
  restoreDatabaseFile
} from '../src/libsql.js';
import { collections, migrations } from '../src/model.js';
import { Timings } from '../src/timing.js';
import {
  applyPostUpgradeWrites,
  countRows,
  currentForgeVersion,
  expectCleanSchemaAndLedger,
  expectDraftVisibility,
  expectFiles,
  expectFixtureCounts,
  expectHistoricalAuth,
  expectHistoricalContent,
  expectHistoryAndRestore,
  expectIntegrityAndProjection,
  expectMigrationsAlreadyApplied,
  expectNoSecrets,
  expectPostUpgradeWrites,
  expectPreUpgradePlan,
  expectStableIds,
  leavePendingStorageIntent,
  loginAdmin
} from '../src/verify.js';

// Spec 073 (roadmap 0.7 M03) — the portable profile: a real on-disk libSQL database, no InMemory
// database anywhere. Objects go through the same adapter-neutral backup code as R2, against
// InMemoryStorageAdapter here; the same flow with a real S3 service is test/s3/backup-libsql-s3.test.ts (spec 084).

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forge-rehearsal-${label}-`));
  scratch.push(dir);
  return dir;
}

/** The historical installation as found: its database file and its object store. */
async function historicalInstallation(fixture: Fixture, dir: string) {
  const path = join(dir, 'source.sqlite');
  await createDatabaseFromSql(path, fixture.databaseSql);
  const storage = new InMemoryStorageAdapter();
  for (const object of fixture.objects) {
    await storage.put({
      key: object.key,
      body: object.bytes,
      ...(object.contentType !== null && { contentType: object.contentType }),
      ...(Object.keys(object.metadata).length > 0 && { metadata: object.metadata })
    });
  }
  return { path, storage, installation: openLibsqlInstallation(path, storage) };
}

describe.each(FIXTURE_VERSIONS)('libSQL (on disk) — installation written by %s', (version) => {
  it('upgrades through planSchema → reviewed migrations → clean plan, and everything still works', async () => {
    const fixture = loadFixture(version);
    const timings = new Timings(`libsql upgrade ${version}`);
    const { installation } = await timings.time('load fixture', () =>
      historicalInstallation(fixture, tempDir('upgrade'))
    );
    try {
      await expectFixtureCounts(installation, fixture);

      await timings.time('upgrade', async () => {
        expectPreUpgradePlan(await installation.runtime.planSchema());
        // Startup never migrates: the plain sync refuses and touches nothing.
        await expect(installation.runtime.syncSchema()).rejects.toSatisfy(isSchemaDriftError);
        const report = await installation.runtime.runMigrations(migrations, {
          allowDestructive: true
        });
        expect(report.before.blocking).toBe(true);
        expect(report.results.map((r) => r.outcome)).toEqual(['applied', 'applied', 'applied']);
        expect(report.after.blocking).toBe(false);
      });

      await timings.time('verify', async () => {
        const history = await expectCleanSchemaAndLedger(installation);
        expect(await countRows(installation)).toEqual({
          users: 2,
          categories: 2,
          media: 2,
          posts: 2,
          _versions_posts: fixture.manifest.counts['_versions_posts'],
          _global_settings: 1,
          _forge_api_keys: 2,
          _forge_migrations: 3,
          _forge_storage_intents: 0
        });
        await expectStableIds(installation, fixture);
        await expectHistoricalAuth(installation, fixture);
        await expectHistoricalContent(installation, fixture);
        await expectDraftVisibility(installation, fixture, {
          published: ['post_published'],
          all: ['post_draft', 'post_published']
        });
        await expectIntegrityAndProjection(installation);
        const admin = await loginAdmin(installation, fixture);
        await expectFiles(installation, fixture.objects, admin.token);
        await expectHistoryAndRestore(installation, fixture);
        const writes = await applyPostUpgradeWrites(installation, fixture);
        await expectPostUpgradeWrites(installation, writes);
        await expectDraftVisibility(installation, fixture, {
          published: ['post_after_upgrade', 'post_draft', 'post_published'],
          all: ['post_after_upgrade', 'post_draft', 'post_published']
        });
        await expectMigrationsAlreadyApplied(installation, history);
      });
    } finally {
      installation.close();
      timings.record();
    }
  });

  it('backs up the upgraded installation and restores it into an isolated, empty database', async () => {
    const fixture = loadFixture(version);
    const timings = new Timings(`libsql backup/restore ${version}`);
    const sourceDir = tempDir('source');
    const backupDir = tempDir('backup');
    const targetDir = tempDir('target');

    // --- The live installation: upgraded, written to, with one pending storage intent. ---------------
    const {
      path: sourcePath,
      storage: sourceStorage,
      installation: source
    } = await historicalInstallation(fixture, sourceDir);
    await source.runtime.runMigrations(migrations, { allowDestructive: true });
    const writes = await applyPostUpgradeWrites(source, fixture);
    const orphanKey = await leavePendingStorageIntent(
      source,
      (await loginAdmin(source, fixture)).token
    );
    const before = {
      counts: await countRows(source),
      history: await source.runtime.readMigrationHistory()
    };
    expect(before.counts['_forge_storage_intents']).toBe(1);

    // --- Quiesce: the application stops writing. Nothing below uses `source` again. ----------------
    source.close();

    // --- Back up: database snapshot, then exactly the objects that snapshot references. ------------
    const manifest = await timings.time('backup', async () => {
      const database = await coldBackupDatabase(sourcePath, backupDir);
      const snapshot = createClient({ url: fileUrl(join(backupDir, database.file)) });
      const keys = await requiredStorageKeys(snapshot, collections);
      snapshot.close();
      // The pending intent's object belongs to a deleted document: not live content, not required.
      expect(keys).toEqual(fixture.objects.map((o) => o.key).sort());
      expect(keys).not.toContain(orphanKey);
      return writeBackup({
        dir: backupDir,
        profile: 'libsql',
        forgeVersion: currentForgeVersion(),
        database,
        storage: sourceStorage,
        keys
      });
    });
    expect(manifest.objects).toHaveLength(fixture.objects.length);
    expectNoSecrets(readFileSync(join(backupDir, MANIFEST_FILE), 'utf8'), fixture);
    verifyBackup(backupDir);

    // --- The source is gone. The restore cannot lean on it. -----------------------------------------
    rmSync(sourcePath);
    expect(existsSync(sourcePath)).toBe(false);

    // --- Restore into an empty target: a new path and a new, empty object store. -------------------
    const targetPath = join(targetDir, 'restored.sqlite');
    const targetStorage = new InMemoryStorageAdapter();
    expect(existsSync(targetPath)).toBe(false);
    expect(await targetStorage.list()).toEqual([]);
    await timings.time('restore', async () => {
      restoreDatabaseFile(backupDir, manifest.database.file, targetPath);
      await restoreObjects(backupDir, targetStorage);
    });

    const restored = openLibsqlInstallation(targetPath, targetStorage);
    try {
      await timings.time('verify', async () => {
        const history = await expectCleanSchemaAndLedger(restored);
        expect(history).toEqual(before.history);
        expect(await countRows(restored)).toEqual(before.counts);
        await expectMigrationsAlreadyApplied(restored, history);
        await expectStableIds(restored, fixture);
        await expectHistoricalAuth(restored, fixture);
        await expectPostUpgradeWrites(restored, writes);
        const admin = await loginAdmin(restored, fixture);
        await expectFiles(restored, fixture.objects, admin.token);

        // Writable, not just readable.
        await restored.runtime.update({
          collection: 'posts',
          id: 'post_published',
          user: admin.user,
          overrideAccess: false,
          data: { title: 'Restored and editable' }
        });
        expect(
          (await restored.runtime.findByID({ collection: 'posts', id: 'post_published' }))['title']
        ).toBe('Restored and editable');

        // The restored intent is worked off once; a second run has nothing to do.
        const first = await restored.runtime.reconcileStorage();
        expect(first.deleted).toEqual([orphanKey]);
        expect(first.failed).toEqual([]);
        const second = await restored.runtime.reconcileStorage();
        expect(second).toEqual({ deleted: [], kept: [], pending: 0, failed: [] });
        expect((await countRows(restored))['_forge_storage_intents']).toBe(0);
      });
    } finally {
      restored.close();
      timings.record();
    }
  });
});
