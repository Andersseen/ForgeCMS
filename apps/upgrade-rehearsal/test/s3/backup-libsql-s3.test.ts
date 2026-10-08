import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PutObjectOptions, StorageAdapter, StorageObject } from '@forge-cms/storage';
import {
  BackupError,
  MANIFEST_FILE,
  objectFileFor,
  requiredStorageKeys,
  restoreObjects,
  verifyBackup,
  writeBackup
} from '../../src/backup.js';
import { FIXTURE_VERSIONS, loadFixture, sha256Hex, type Fixture } from '../../src/fixtures.js';
import {
  coldBackupDatabase,
  createDatabaseFromSql,
  fileUrl,
  openLibsqlInstallation,
  restoreDatabaseFile
} from '../../src/libsql.js';
import { collections, migrations } from '../../src/model.js';
import { S3_SERVICE, emptyBucket, freshBucket } from '../../src/s3.js';
import { Timings } from '../../src/timing.js';
import {
  applyPostUpgradeWrites,
  countRows,
  currentForgeVersion,
  expectCleanSchemaAndLedger,
  expectDraftVisibility,
  expectFiles,
  expectHistoricalAuth,
  expectMigrationsAlreadyApplied,
  expectNoSecrets,
  expectPostUpgradeWrites,
  expectStableIds,
  leavePendingStorageIntent,
  loginAdmin
} from '../../src/verify.js';

// Spec 084 (roadmap 0.10 / P03) — the portable profile's recovery evidence with REAL object storage: an
// on-disk libSQL database + `@forge-cms/s3` against the Garage service `pnpm test:s3` starts. The generic
// backup helper (`src/backup.ts`) is the same provider-neutral code the D1/R2 lane runs; nothing in it knows
// S3. The source and the restore target are different buckets of the same throwaway service, and the source
// is emptied before the restore, so a restore that leaned on it would fail.

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forge-rehearsal-s3-${label}-`));
  scratch.push(dir);
  return dir;
}

async function putAll(storage: StorageAdapter, objects: Fixture['objects']) {
  for (const object of objects) {
    await storage.put({
      key: object.key,
      body: object.bytes,
      ...(object.contentType !== null && { contentType: object.contentType }),
      ...(Object.keys(object.metadata).length > 0 && { metadata: object.metadata })
    });
  }
}

/** Posts with populated relations, categories and the global, exactly as the live code returns them. */
async function readContent(installation: ReturnType<typeof openLibsqlInstallation>) {
  const { runtime } = installation;
  return {
    posts: await Promise.all(
      ['post_published', 'post_draft'].map((id) =>
        runtime.findByID({ collection: 'posts', id, depth: 1 })
      )
    ),
    categories: (await runtime.find({ collection: 'categories', limit: 100 })).docs
  };
}

/** The historical installation as found: its database file and its (S3) object store. */
async function historicalInstallation(fixture: Fixture, dir: string) {
  const path = join(dir, 'source.sqlite');
  await createDatabaseFromSql(path, fixture.databaseSql);
  const { bucket, storage } = await freshBucket();
  await putAll(storage, fixture.objects);
  return {
    path,
    bucket,
    storage,
    installation: openLibsqlInstallation(path, storage, 'libsql-s3')
  };
}

describe.each(FIXTURE_VERSIONS)(
  'libSQL (on disk) + S3 (Garage) — installation written by %s',
  (version) => {
    it('upgrades, backs up from the database snapshot, and restores into an isolated EMPTY bucket', async () => {
      const fixture = loadFixture(version);
      const timings = new Timings(`libsql+s3 backup/restore ${version}`);
      const sourceDir = tempDir('source');
      const backupDir = tempDir('backup');
      const targetDir = tempDir('target');

      // --- The live installation: upgraded, written to, with one pending storage intent. ---------------
      const {
        path: sourcePath,
        bucket: sourceBucket,
        storage: sourceStorage,
        installation: source
      } = await historicalInstallation(fixture, sourceDir);
      expect(sourceStorage.name).toBe('s3');
      await source.runtime.runMigrations(migrations, { allowDestructive: true });
      const writes = await applyPostUpgradeWrites(source, fixture);
      const orphanKey = await leavePendingStorageIntent(
        source,
        (await loginAdmin(source, fixture)).token
      );
      const before = {
        counts: await countRows(source),
        history: await source.runtime.readMigrationHistory(),
        content: await readContent(source),
        versions: await source.runtime.listVersions({
          collection: 'posts',
          documentId: 'post_published'
        })
      };
      expect(before.counts['_forge_storage_intents']).toBe(1);
      // The pending intent's object really is in the source bucket (alongside the live ones).
      expect((await sourceStorage.list()).map((o) => o.key)).toContain(orphanKey);

      // --- Quiesce: the application stops writing. Nothing below uses `source` again. ----------------
      source.close();

      // --- Back up: database snapshot, then exactly the objects that snapshot references. ------------
      const manifest = await timings.time('backup', async () => {
        const database = await coldBackupDatabase(sourcePath, backupDir);
        const snapshot = createClient({ url: fileUrl(join(backupDir, database.file)) });
        const keys = await requiredStorageKeys(snapshot, collections);
        snapshot.close();
        // Derived from the snapshot, never from a bucket listing: the orphan is listed but not required.
        expect(keys).toEqual(fixture.objects.map((o) => o.key).sort());
        expect(keys).not.toContain(orphanKey);
        expect((await sourceStorage.list()).length).toBeGreaterThan(keys.length);
        return writeBackup({
          dir: backupDir,
          profile: 'libsql-s3',
          forgeVersion: currentForgeVersion(),
          database,
          storage: sourceStorage,
          keys
        });
      });
      expect(manifest.profile).toBe('libsql-s3');
      expect(manifest.objects).toHaveLength(fixture.objects.length);
      for (const object of manifest.objects) {
        const original = fixture.objects.find((o) => o.key === object.key)!;
        expect(object.sha256).toBe(original.sha256);
        expect(object.size).toBe(original.size);
        expect(object.contentType).toBe(original.contentType);
        expect(object.metadata).toEqual(original.metadata);
      }
      // No credential of any kind in the manifest (nor in any backup file name).
      const manifestText = readFileSync(join(backupDir, MANIFEST_FILE), 'utf8');
      expectNoSecrets(manifestText, fixture);
      expect(manifestText).not.toContain(S3_SERVICE.secretAccessKey);
      expect(manifestText).not.toContain(S3_SERVICE.accessKeyId);
      expect(manifestText).not.toContain(S3_SERVICE.endpoint);
      verifyBackup(backupDir);

      // --- The source is gone. The restore cannot lean on it. -----------------------------------------
      rmSync(sourcePath);
      await emptyBucket(sourceStorage);
      expect(existsSync(sourcePath)).toBe(false);
      expect(await sourceStorage.list()).toEqual([]);

      // --- Restore into an empty target: a new path and a different, empty bucket. -------------------
      const targetPath = join(targetDir, 'restored.sqlite');
      const { bucket: targetBucket, storage: targetStorage } = await freshBucket();
      expect(targetBucket).not.toBe(sourceBucket);
      expect(existsSync(targetPath)).toBe(false);
      expect(await targetStorage.list()).toEqual([]);
      await timings.time('restore', async () => {
        restoreDatabaseFile(backupDir, manifest.database.file, targetPath);
        await restoreObjects(backupDir, targetStorage);
      });
      // Exactly the required objects, nothing else (the orphan was not carried over).
      expect((await targetStorage.list()).map((o) => o.key).sort()).toEqual(
        fixture.objects.map((o) => o.key).sort()
      );

      // A completely new runtime that only knows the restored file and the TARGET bucket.
      const restored = openLibsqlInstallation(targetPath, targetStorage, 'libsql-s3');
      try {
        await timings.time('verify', async () => {
          const history = await expectCleanSchemaAndLedger(restored);
          expect(history).toEqual(before.history);
          expect(await countRows(restored)).toEqual(before.counts);
          await expectMigrationsAlreadyApplied(restored, history);
          await expectStableIds(restored, fixture);
          await expectHistoricalAuth(restored, fixture);
          await expectPostUpgradeWrites(restored, writes);
          await expectDraftVisibility(restored, fixture, {
            published: ['post_after_upgrade', 'post_draft', 'post_published'],
            all: ['post_after_upgrade', 'post_draft', 'post_published']
          });
          // Relations, localized values and globals, as the historical installation wrote them.
          expect(await readContent(restored)).toEqual(before.content);
          // Version history is identical to what the live installation had at backup time.
          expect(
            await restored.runtime.listVersions({
              collection: 'posts',
              documentId: 'post_published'
            })
          ).toEqual(before.versions);
          const admin = await loginAdmin(restored, fixture);
          // Every owned file: document ↔ `_storageKey` ↔ S3 object (bytes, type, metadata) ↔ handleFile.
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
            (await restored.runtime.findByID({ collection: 'posts', id: 'post_published' }))[
              'title'
            ]
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
        await emptyBucket(targetStorage);
      }
    });
  }
);

/** Delegates to the real S3 target but can damage what is written (a faulty or lying store). */
class TamperingStorage implements StorageAdapter {
  readonly name = 's3';
  constructor(
    private readonly inner: StorageAdapter,
    private readonly tamper: (options: PutObjectOptions) => PutObjectOptions
  ) {}
  init(): this {
    return this;
  }
  put(options: PutObjectOptions): Promise<StorageObject> {
    return this.inner.put(this.tamper(options));
  }
  get(key: string): Promise<StorageObject | null> {
    return this.inner.get(key);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
  getPublicUrl(key: string): Promise<string> {
    return this.inner.getPublicUrl(key);
  }
  list(prefix?: string): Promise<StorageObject[]> {
    return this.inner.list(prefix);
  }
}

describe('real-S3 recovery failure controls', () => {
  const fixture = loadFixture('0.8.0');

  /** A database snapshot of the historical installation plus a source bucket holding `objects`. */
  async function prepared(objects: Fixture['objects']) {
    const dir = tempDir('control');
    const dbPath = join(dir, 'source.sqlite');
    await createDatabaseFromSql(dbPath, fixture.databaseSql);
    const backupDir = tempDir('control-backup');
    const database = await coldBackupDatabase(dbPath, backupDir);
    const snapshot = createClient({ url: fileUrl(join(backupDir, database.file)) });
    const keys = await requiredStorageKeys(snapshot, collections);
    snapshot.close();
    const { storage } = await freshBucket();
    await putAll(storage, objects);
    return { backupDir, database, keys, storage };
  }

  const backup = async (p: Awaited<ReturnType<typeof prepared>>) =>
    writeBackup({
      dir: p.backupDir,
      profile: 'libsql-s3',
      forgeVersion: currentForgeVersion(),
      database: p.database,
      storage: p.storage,
      keys: p.keys
    });

  it('a snapshot that references an object the bucket does not have fails the backup — no manifest', async () => {
    const [missing, ...rest] = fixture.objects;
    const p = await prepared(rest);
    expect(p.keys).toContain(missing!.key);
    await expect(backup(p)).rejects.toThrow(BackupError);
    await expect(backup(p)).rejects.toThrow(
      `missing required object ${JSON.stringify(missing!.key)}`
    );
    expect(existsSync(join(p.backupDir, MANIFEST_FILE))).toBe(false);
    expect(() => verifyBackup(p.backupDir)).toThrow(/not a complete backup/);
  });

  it('a restore target that already holds a required key refuses and overwrites nothing', async () => {
    const p = await prepared(fixture.objects);
    await backup(p);
    const { storage: target } = await freshBucket();
    const [taken] = fixture.objects;
    await target.put({ key: taken!.key, body: new TextEncoder().encode('already here') });
    await expect(restoreObjects(p.backupDir, target)).rejects.toThrow(
      /restore target is not empty/
    );
    expect(new TextDecoder().decode((await target.get(taken!.key))!.body)).toBe('already here');
    expect((await target.list()).map((o) => o.key)).toEqual([taken!.key]);
  });

  it('a corrupted backup object is rejected BEFORE the S3 target is touched', async () => {
    const p = await prepared(fixture.objects);
    const manifest = await backup(p);
    const victim = join(p.backupDir, manifest.objects[0]!.file);
    const bytes = readFileSync(victim);
    bytes[0] = bytes[0]! ^ 0xff;
    writeFileSync(victim, bytes);
    const { storage: target } = await freshBucket();
    await expect(restoreObjects(p.backupDir, target)).rejects.toThrow(/checksum mismatch/);
    expect(await target.list()).toEqual([]);
    // A missing object file is rejected the same way.
    rmSync(victim);
    await expect(restoreObjects(p.backupDir, target)).rejects.toThrow(/is missing/);
    expect(await target.list()).toEqual([]);
  });

  it.each([
    [
      'bytes',
      (o: PutObjectOptions) => ({ ...o, body: new TextEncoder().encode('tampered') }),
      /bytes differ/
    ],
    [
      'content type',
      (o: PutObjectOptions) => ({ ...o, contentType: 'application/x-evil' }),
      /content type differs/
    ],
    [
      'metadata',
      (o: PutObjectOptions) => {
        const { metadata: _dropped, ...rest } = o;
        void _dropped;
        return { ...rest, metadata: { forged: 'yes' } };
      },
      /metadata differs/
    ]
  ])(
    'restore verification reports an object whose %s do not match',
    async (_label, tamper, message) => {
      const p = await prepared(fixture.objects);
      await backup(p);
      const { storage: target } = await freshBucket();
      await expect(
        restoreObjects(p.backupDir, new TamperingStorage(target, tamper))
      ).rejects.toThrow(message);
    }
  );

  it('keeps backup file names independent of keys (hashed), even for awkward S3 keys', async () => {
    const dir = tempDir('awkward');
    const backupDir = tempDir('awkward-backup');
    const { storage } = await freshBucket();
    const key = "media/../ünï cødé/#?%&*/it's.txt";
    await storage.put({
      key,
      body: new TextEncoder().encode('awkward'),
      contentType: 'text/plain'
    });
    writeFileSync(join(dir, 'db.sqlite'), 'not a database');
    const manifest = await writeBackup({
      dir: backupDir,
      profile: 'libsql-s3',
      forgeVersion: '0.0.0-test',
      database: { file: '../db.sqlite', sha256: '0'.repeat(64), size: 0 },
      storage,
      keys: [key]
    });
    expect(manifest.objects[0]!.file).toBe(objectFileFor(key));
    expect(readdirSync(join(backupDir, 'objects'))).toEqual([`${sha256Hex(key)}.bin`]);
  });
});
