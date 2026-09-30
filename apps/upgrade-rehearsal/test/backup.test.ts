import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  BackupError,
  MANIFEST_FILE,
  objectFileFor,
  restoreObjects,
  verifyBackup,
  writeBackup
} from '../src/backup.js';
import { sha256Hex } from '../src/fixtures.js';

// Spec 073 §20/§23/§53/§54 — the backup helper's failure modes, offline and fast (`pnpm test`). The
// same code runs against R2 in the D1/R2 rehearsal; InMemoryStorageAdapter stands in for any store.

const AWKWARD_KEY = 'media/../ünïcødé dir/#?%&*/..\\evil:name.txt';
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-backup-unit-'));
  scratch.push(dir);
  return dir;
}

async function sourceWith(
  objects: { key: string; text: string; type?: string; meta?: Record<string, string> }[]
) {
  const storage = new InMemoryStorageAdapter();
  for (const o of objects) {
    await storage.put({
      key: o.key,
      body: new TextEncoder().encode(o.text),
      ...(o.type !== undefined && { contentType: o.type }),
      ...(o.meta !== undefined && { metadata: o.meta })
    });
  }
  return storage;
}

async function backup(dir: string, storage: InMemoryStorageAdapter, keys: string[]) {
  writeFileSync(join(dir, 'database.sqlite'), 'not a real database, only bytes to checksum');
  const bytes = readFileSync(join(dir, 'database.sqlite'));
  return writeBackup({
    dir,
    profile: 'libsql',
    forgeVersion: '0.0.0-test',
    database: { file: 'database.sqlite', sha256: sha256Hex(bytes), size: bytes.byteLength },
    storage,
    keys
  });
}

describe('rehearsal backup helper', () => {
  it('never turns a storage key into a path: an awkward key round-trips through a hashed file name', async () => {
    const dir = tempDir();
    const source = await sourceWith([
      { key: AWKWARD_KEY, text: 'awkward', type: 'text/plain', meta: { note: 'ü' } }
    ]);
    const manifest = await backup(dir, source, [AWKWARD_KEY]);
    expect(manifest.objects[0]!.file).toBe(objectFileFor(AWKWARD_KEY));
    expect(readdirSync(join(dir, 'objects'))).toEqual([`${sha256Hex(AWKWARD_KEY)}.bin`]);
    expect(readdirSync(dir).sort()).toEqual([MANIFEST_FILE, 'database.sqlite', 'objects']);

    const target = new InMemoryStorageAdapter();
    await restoreObjects(dir, target);
    const restored = await target.get(AWKWARD_KEY);
    expect(new TextDecoder().decode(restored!.body)).toBe('awkward');
    expect(restored!.contentType).toBe('text/plain');
    expect(restored!.metadata).toEqual({ note: 'ü' });
  });

  it('fails a backup whose snapshot references an object the storage does not have — and writes no manifest', async () => {
    const dir = tempDir();
    const source = await sourceWith([{ key: 'media/present.png', text: 'x' }]);
    await expect(backup(dir, source, ['media/present.png', 'media/missing.png'])).rejects.toThrow(
      /missing required object "media\/missing.png"/
    );
    expect(existsSync(join(dir, MANIFEST_FILE))).toBe(false);
    expect(() => verifyBackup(dir)).toThrow(BackupError);
  });

  it('rejects a corrupted object before restoring anything', async () => {
    const dir = tempDir();
    const source = await sourceWith([
      { key: 'media/a.png', text: 'first' },
      { key: 'media/b.png', text: 'second' }
    ]);
    await backup(dir, source, ['media/a.png', 'media/b.png']);
    const file = join(dir, objectFileFor('media/b.png'));
    const bytes = readFileSync(file);
    bytes[0] = bytes[0]! ^ 0xff;
    writeFileSync(file, bytes);

    expect(() => verifyBackup(dir)).toThrow(/object "media\/b.png": checksum mismatch/);
    const target = new InMemoryStorageAdapter();
    await expect(restoreObjects(dir, target)).rejects.toThrow(BackupError);
    expect(await target.list()).toEqual([]);
  });

  it('rejects a corrupted database file and a deleted object file', async () => {
    const dir = tempDir();
    const source = await sourceWith([{ key: 'media/a.png', text: 'first' }]);
    await backup(dir, source, ['media/a.png']);
    writeFileSync(join(dir, 'database.sqlite'), 'not a real database, only bytes to checksuM');
    expect(() => verifyBackup(dir)).toThrow(/database: checksum mismatch/);

    const other = tempDir();
    await backup(other, source, ['media/a.png']);
    rmSync(join(other, objectFileFor('media/a.png')));
    expect(() => verifyBackup(other)).toThrow(/object "media\/a.png": file .* is missing/);
  });

  it('refuses to restore over an object that already exists in the target', async () => {
    const dir = tempDir();
    const source = await sourceWith([{ key: 'media/a.png', text: 'backup' }]);
    await backup(dir, source, ['media/a.png']);
    const target = await sourceWith([{ key: 'media/a.png', text: 'already here' }]);
    await expect(restoreObjects(dir, target)).rejects.toThrow(/restore target is not empty/);
    expect(new TextDecoder().decode((await target.get('media/a.png'))!.body)).toBe('already here');
  });
});
