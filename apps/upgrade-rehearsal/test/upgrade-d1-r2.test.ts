import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { isSchemaDriftError } from '@forge-cms/db';
import { R2StorageAdapter } from '@forge-cms/cloudflare';
import {
  BackupError,
  MANIFEST_FILE,
  requiredStorageKeys,
  restoreObjects,
  verifyBackup,
  writeBackup
} from '../src/backup.js';
import { LocalCloudflareEnvironment, openCloudflareInstallation } from '../src/cloudflare.js';
import { FIXTURE_VERSIONS, loadFixture, sha256Hex, type Fixture } from '../src/fixtures.js';
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

// Spec 073 (roadmap 0.7 M03) — local Cloudflare: real D1 and R2 bindings in workerd (Miniflare) and
// the repository's pinned Wrangler for the documented `d1 export`/`d1 execute --file` paths, each
// environment in its own directory. `--local` only: no account, no credentials, nothing remote.
// Local evidence does not prove a remote Cloudflare configuration.

const SOURCE_DB = '00000000-0000-4000-8000-0000000d1500';
const RESTORED_DB = '00000000-0000-4000-8000-0000000d1600';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forge-rehearsal-${label}-`));
  scratch.push(dir);
  return dir;
}

/** The historical installation as found: fixture SQL imported with Wrangler, objects put into R2. */
async function historicalEnvironment(fixture: Fixture, root: string) {
  const environment = new LocalCloudflareEnvironment(join(root, 'source'), SOURCE_DB);
  const sqlPath = join(root, 'fixture.sql');
  writeFileSync(sqlPath, fixture.databaseSql);
  environment.importSql(sqlPath);
  const { bucket, dispose } = await environment.start();
  const storage = new R2StorageAdapter().init({ BUCKET: bucket });
  for (const object of fixture.objects) {
    await storage.put({
      key: object.key,
      body: object.bytes,
      ...(object.contentType !== null && { contentType: object.contentType }),
      ...(Object.keys(object.metadata).length > 0 && { metadata: object.metadata })
    });
  }
  await dispose();
  return environment;
}

async function userTables(environment: LocalCloudflareEnvironment): Promise<string[]> {
  const { db, dispose } = await environment.start();
  try {
    const { results } = await db
      .prepare(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ` +
          `AND "name" NOT LIKE 'sqlite_%' AND "name" NOT LIKE '_cf_%'`
      )
      .all<{ name: string }>();
    return (results ?? []).map((r) => r.name);
  } finally {
    await dispose();
  }
}

describe.each(FIXTURE_VERSIONS)('local D1 + R2 — installation written by %s', (version) => {
  it('upgrades through planSchema → reviewed migrations → clean plan, and everything still works', async () => {
    const fixture = loadFixture(version);
    const timings = new Timings(`d1-r2 upgrade ${version}`);
    const environment = await timings.time('load fixture', () =>
      historicalEnvironment(fixture, tempDir('d1-upgrade'))
    );
    const installation = await openCloudflareInstallation(environment);
    try {
      await expectFixtureCounts(installation, fixture);

      await timings.time('upgrade', async () => {
        expectPreUpgradePlan(await installation.runtime.planSchema());
        await expect(installation.runtime.syncSchema()).rejects.toSatisfy(isSchemaDriftError);
        const report = await installation.runtime.runMigrations(migrations, {
          allowDestructive: true
        });
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
        await expectMigrationsAlreadyApplied(installation, history);
      });
    } finally {
      await installation.dispose();
      timings.record();
    }
  });

  it('backs up with `wrangler d1 export` + the referenced R2 objects and restores into an isolated, empty D1/R2', async () => {
    const fixture = loadFixture(version);
    const timings = new Timings(`d1-r2 backup/restore ${version}`);
    const root = tempDir('d1-backup');
    const backupDir = tempDir('d1-backup-files');

    // --- The live installation: upgraded, written to, with one pending storage intent. ---------------
    const source = await historicalEnvironment(fixture, root);
    const live = await openCloudflareInstallation(source);
    await live.runtime.runMigrations(migrations, { allowDestructive: true });
    const writes = await applyPostUpgradeWrites(live, fixture);
    const orphanKey = await leavePendingStorageIntent(
      live,
      (await loginAdmin(live, fixture)).token
    );
    const before = {
      counts: await countRows(live),
      history: await live.runtime.readMigrationHistory()
    };

    // --- Quiesce: no process serves the source any more. ---------------------------------------------
    await live.dispose();

    const manifest = await timings.time('backup', async () => {
      // 1. Database snapshot through the documented export path.
      const exportPath = join(backupDir, 'database.sql');
      source.exportSql(exportPath);
      const exported = readFileSync(exportPath);
      expect(exported.toString('utf8')).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);

      // 2. The keys that snapshot references — read from the export itself.
      const snapshot = createClient({ url: ':memory:' });
      await snapshot.executeMultiple(exported.toString('utf8'));
      const keys = await requiredStorageKeys(snapshot, collections);
      snapshot.close();
      expect(keys).toEqual(fixture.objects.map((o) => o.key).sort());
      expect(keys).not.toContain(orphanKey);

      // 3. Exactly those objects, with bytes, content type and custom metadata.
      const { bucket, dispose } = await source.start();
      try {
        return await writeBackup({
          dir: backupDir,
          profile: 'd1-r2',
          forgeVersion: currentForgeVersion(),
          database: {
            file: 'database.sql',
            sha256: sha256Hex(exported),
            size: statSync(exportPath).size
          },
          storage: new R2StorageAdapter().init({ BUCKET: bucket }),
          keys
        });
      } finally {
        await dispose();
      }
    });
    expectNoSecrets(readFileSync(join(backupDir, MANIFEST_FILE), 'utf8'), fixture);
    verifyBackup(backupDir);

    // A tampered export is refused before anything could be imported.
    const tampered = tempDir('d1-tampered');
    cpSync(backupDir, tampered, { recursive: true });
    const exportCopy = join(tampered, 'database.sql');
    writeFileSync(
      exportCopy,
      readFileSync(exportCopy, 'utf8').replace('Hello Forge', 'Hello F0rge')
    );
    expect(() => verifyBackup(tampered)).toThrow(BackupError);

    // --- The source environment is destroyed. -------------------------------------------------------
    rmSync(source.dir, { recursive: true, force: true });
    expect(existsSync(source.dir)).toBe(false);

    // --- A separate, empty target: its own directory, D1 id and bucket state. ------------------------
    const target = new LocalCloudflareEnvironment(join(root, 'restored'), RESTORED_DB);
    expect(await userTables(target)).toEqual([]);
    {
      const { bucket, dispose } = await target.start();
      expect((await bucket.list()).objects).toEqual([]);
      await dispose();
    }

    // --- Restore while offline: database, then objects, both verified before the app starts. --------
    await timings.time('restore', async () => {
      verifyBackup(backupDir);
      target.importSql(join(backupDir, manifest.database.file));
      const { bucket, dispose } = await target.start();
      try {
        await restoreObjects(backupDir, new R2StorageAdapter().init({ BUCKET: bucket }));
      } finally {
        await dispose();
      }
    });

    const restored = await openCloudflareInstallation(target);
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

        const first = await restored.runtime.reconcileStorage();
        expect(first.deleted).toEqual([orphanKey]);
        expect(first.failed).toEqual([]);
        const second = await restored.runtime.reconcileStorage();
        expect(second).toEqual({ deleted: [], kept: [], pending: 0, failed: [] });
      });
    } finally {
      await restored.dispose();
      timings.record();
    }
  });
});
