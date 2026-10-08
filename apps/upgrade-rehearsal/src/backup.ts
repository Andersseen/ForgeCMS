import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import type { CollectionDefinition } from '@forge-cms/core';
import type { StorageAdapter } from '@forge-cms/storage';
import { sha256Hex } from './fixtures.js';

/**
 * The rehearsal's backup format (spec 073 §7). Private test/recovery infrastructure — not a public
 * ForgeCMS API. It records what was copied and how to check it; it never holds credentials.
 */
export interface BackupManifest {
  format: 1;
  createdAt: string;
  profile: 'libsql' | 'libsql-s3' | 'd1-r2';
  forgeVersion: string;
  database: { file: string; sha256: string; size: number };
  objects: BackupObject[];
}

export interface BackupObject {
  key: string;
  /** `objects/<sha256(key)>.bin` — a key never becomes a path (`../`, slashes, Unicode are safe). */
  file: string;
  sha256: string;
  size: number;
  contentType: string | null;
  metadata: Record<string, string>;
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly problems: readonly string[] = []
  ) {
    super(problems.length > 0 ? `${message}\n- ${problems.join('\n- ')}` : message);
    this.name = 'BackupError';
  }
}

export const MANIFEST_FILE = 'backup-manifest.json';

/** Custom metadata compared independently of key order. */
export function canonicalMetadata(metadata: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

export function objectFileFor(key: string): string {
  return `objects/${sha256Hex(key)}.bin`;
}

/** Upload-enabled collections: the only places a Forge document references a stored object. */
export function uploadCollections(collections: readonly CollectionDefinition[]): string[] {
  return collections.filter((c) => c.upload === true).map((c) => c.slug);
}

/**
 * The object keys the **database snapshot** needs: every non-null `_storageKey` of every upload
 * collection, read from the snapshot itself (never from a live database, never from a bucket listing —
 * `StorageAdapter.list()` has no pagination and R2 caps it at 1000). Orphans and objects queued for
 * deletion by a storage intent are not live content and are deliberately not required.
 */
export async function requiredStorageKeys(
  snapshot: Client,
  collections: readonly CollectionDefinition[]
): Promise<string[]> {
  const keys = new Set<string>();
  for (const slug of uploadCollections(collections)) {
    const result = await snapshot.execute(
      `SELECT "_storageKey" AS "key" FROM "${slug}" WHERE "_storageKey" IS NOT NULL`
    );
    for (const row of result.rows) keys.add(String(row['key']));
  }
  return [...keys].sort();
}

async function readBytes(object: { body?: ArrayBuffer }): Promise<Uint8Array> {
  if (!object.body) throw new BackupError('storage returned an object without a body');
  return new Uint8Array(object.body);
}

/**
 * Copies every required object into `dir/objects/`, re-reads each written file and checks its SHA-256,
 * then writes the manifest **last**. A required object the storage cannot return fails the whole
 * backup before any manifest exists, so an incomplete backup can never look complete.
 */
export async function writeBackup(options: {
  dir: string;
  profile: BackupManifest['profile'];
  forgeVersion: string;
  database: { file: string; sha256: string; size: number };
  storage: StorageAdapter;
  keys: readonly string[];
}): Promise<BackupManifest> {
  const { dir, storage, keys } = options;
  mkdirSync(join(dir, 'objects'), { recursive: true });
  const missing: string[] = [];
  const objects: BackupObject[] = [];
  for (const key of keys) {
    const object = await storage.get(key);
    if (!object) {
      missing.push(key);
      continue;
    }
    const bytes = await readBytes(object);
    const file = objectFileFor(key);
    writeFileSync(join(dir, file), bytes);
    const digest = sha256Hex(bytes);
    if (sha256Hex(readFileSync(join(dir, file))) !== digest) {
      throw new BackupError(
        `object ${JSON.stringify(key)} did not read back identically after writing`
      );
    }
    objects.push({
      key,
      file,
      sha256: digest,
      size: bytes.byteLength,
      contentType: object.contentType ?? null,
      metadata: { ...(object.metadata ?? {}) }
    });
  }
  if (missing.length > 0) {
    throw new BackupError(
      'Backup incomplete: the database snapshot references objects the storage does not have',
      missing.map((key) => `missing required object ${JSON.stringify(key)}`)
    );
  }
  const manifest: BackupManifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    profile: options.profile,
    forgeVersion: options.forgeVersion,
    database: options.database,
    objects
  };
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Checks the manifest against the files on disk: database and every object, SHA-256 and size. */
export function verifyBackup(dir: string): BackupManifest {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath))
    throw new BackupError(`no ${MANIFEST_FILE}: not a complete backup`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
  const problems: string[] = [];
  const check = (file: string, sha256: string, size: number, label: string) => {
    const path = join(dir, file);
    if (!existsSync(path)) {
      problems.push(`${label}: file ${file} is missing`);
      return;
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== size)
      problems.push(`${label}: size ${bytes.byteLength}, expected ${size}`);
    if (sha256Hex(bytes) !== sha256) problems.push(`${label}: checksum mismatch`);
  };
  check(manifest.database.file, manifest.database.sha256, manifest.database.size, 'database');
  for (const object of manifest.objects) {
    if (object.file !== objectFileFor(object.key)) {
      problems.push(`object ${JSON.stringify(object.key)}: unexpected file name ${object.file}`);
    }
    check(object.file, object.sha256, object.size, `object ${JSON.stringify(object.key)}`);
  }
  if (problems.length > 0) throw new BackupError('Backup verification failed', problems);
  return manifest;
}

/**
 * Restores every object of a verified backup into an **empty** target, then reads each one back and
 * compares bytes, content type and metadata. Verification runs first, so a corrupt backup writes
 * nothing.
 */
export async function restoreObjects(dir: string, target: StorageAdapter): Promise<BackupManifest> {
  const manifest = verifyBackup(dir);
  for (const object of manifest.objects) {
    if (await target.get(object.key)) {
      throw new BackupError(`restore target is not empty: ${JSON.stringify(object.key)} exists`);
    }
  }
  for (const object of manifest.objects) {
    await target.put({
      key: object.key,
      body: new Uint8Array(readFileSync(join(dir, object.file))),
      ...(object.contentType !== null && { contentType: object.contentType }),
      ...(Object.keys(object.metadata).length > 0 && { metadata: object.metadata })
    });
  }
  const problems: string[] = [];
  for (const object of manifest.objects) {
    const restored = await target.get(object.key);
    if (!restored) {
      problems.push(`${JSON.stringify(object.key)} missing after restore`);
      continue;
    }
    const bytes = await readBytes(restored);
    if (sha256Hex(bytes) !== object.sha256)
      problems.push(`${JSON.stringify(object.key)}: bytes differ`);
    if ((restored.contentType ?? null) !== object.contentType) {
      problems.push(`${JSON.stringify(object.key)}: content type differs`);
    }
    if (canonicalMetadata(restored.metadata) !== canonicalMetadata(object.metadata)) {
      problems.push(`${JSON.stringify(object.key)}: metadata differs`);
    }
  }
  if (problems.length > 0) throw new BackupError('Object restore verification failed', problems);
  return manifest;
}
