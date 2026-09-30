import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { StorageAdapter } from '@forge-cms/storage';
import { BackupError } from './backup.js';
import { sha256Hex } from './fixtures.js';
import { createInstallation, libsqlRows, type Installation } from './runtime.js';

const SIDECARS = ['-journal', '-wal', '-shm'];

export const fileUrl = (path: string) => `file:${path}`;

/** Writes a fixture's SQL into a new on-disk database (the historical installation, as found). */
export async function createDatabaseFromSql(path: string, sql: string): Promise<void> {
  if (existsSync(path))
    throw new Error(`refusing to load a fixture over an existing file: ${path}`);
  const client = createClient({ url: fileUrl(path) });
  try {
    await client.executeMultiple(sql);
  } finally {
    client.close();
  }
}

/** The current ForgeCMS over an on-disk libSQL file, plus a separate read-only client for raw SQL. */
export function openLibsqlInstallation(
  path: string,
  storage: StorageAdapter
): Installation & { close(): void } {
  const raw: Client = createClient({ url: fileUrl(path) });
  const installation = createInstallation({
    profile: 'libsql',
    database: new LibSqlDatabaseAdapter(fileUrl(path)),
    storage,
    sql: libsqlRows(raw)
  });
  return { ...installation, close: () => raw.close() };
}

/**
 * A cold backup of a **quiesced** libSQL file: no writer may be active. The file must be in
 * rollback-journal mode with no `-journal`/`-wal`/`-shm` sidecar — then every committed transaction is
 * in the main file and a byte copy is consistent. Anything else is refused (checkpoint or stop the
 * writer first) rather than copied and called consistent.
 */
export async function coldBackupDatabase(
  sourcePath: string,
  backupDir: string
): Promise<{ file: string; sha256: string; size: number }> {
  const sidecars = SIDECARS.filter((suffix) => existsSync(`${sourcePath}${suffix}`));
  if (sidecars.length > 0) {
    throw new BackupError(
      `refusing a file copy of ${sourcePath}: ${sidecars.join(', ')} present — a writer is active or ` +
        'the database is in WAL mode. Stop writers and checkpoint (PRAGMA wal_checkpoint(TRUNCATE)) first.'
    );
  }
  const probe = createClient({ url: fileUrl(sourcePath) });
  try {
    const mode = String((await probe.execute('PRAGMA journal_mode')).rows[0]?.['journal_mode']);
    if (mode.toLowerCase() === 'wal') {
      throw new BackupError(`refusing a file copy of ${sourcePath}: journal_mode is WAL`);
    }
  } finally {
    probe.close();
  }
  const file = 'database.sqlite';
  copyFileSync(sourcePath, join(backupDir, file));
  const source = sha256Hex(readFileSync(sourcePath));
  const copy = sha256Hex(readFileSync(join(backupDir, file)));
  if (source !== copy) throw new BackupError('database copy does not match its source');
  return { file, sha256: copy, size: statSync(join(backupDir, file)).size };
}

/** Restores the backed-up file to a new path — never over an existing database. */
export function restoreDatabaseFile(backupDir: string, file: string, targetPath: string): void {
  if (existsSync(targetPath)) throw new BackupError(`restore target ${targetPath} already exists`);
  copyFileSync(join(backupDir, file), targetPath);
}
