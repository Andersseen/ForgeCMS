import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Client, type InValue } from '@libsql/client';
import { defineMigration, type MigrationDefinition } from './migrations.js';
import {
  MIGRATION_LEDGER_TABLE,
  readSqliteMigrationHistory,
  runSqliteMigrations
} from './sqlite-migrations.js';
import type { SqliteSchemaExecutor } from './sqlite-schema.js';

// Spec 072 — the migration engine on a real on-disk libSQL file, with an executor whose transport can
// be broken on purpose: the only way to exercise "the batch was sent and the answer was lost".

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const directory = fs.mkdtempSync(`${os.tmpdir()}/forge-migrations-`);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
let files = 0;

type Batch = SqliteSchemaExecutor['batch'];

/** A faultable executor over `client`, exactly as `LibSqlDatabaseAdapter` builds its own. */
function executorOver(
  client: Client,
  faults: {
    batch?: (send: () => Promise<void>, statements: Parameters<Batch>[0]) => Promise<void>;
    query?: () => void;
  } = {}
): SqliteSchemaExecutor {
  const send: Batch = async (statements) => {
    await client.batch(
      statements.map((s) => ({ sql: s.sql, args: (s.args ?? []) as InValue[] })),
      'write'
    );
  };
  return {
    async query(sql, args = []) {
      faults.query?.();
      return (await client.execute({ sql, args: args as InValue[] })).rows.map((r) => ({ ...r }));
    },
    batch: (statements) =>
      faults.batch ? faults.batch(() => send(statements), statements) : send(statements)
  };
}

async function setup() {
  const client = createClient({ url: `file:${directory}/m-${++files}.db` });
  await client.execute('CREATE TABLE "items" ("id" TEXT PRIMARY KEY, "n" INTEGER)');
  const rows = async () =>
    (await client.execute('SELECT "id", "n" FROM "items" ORDER BY "id"')).rows.map((r) => ({
      ...r
    }));
  return { client, rows, executor: executorOver(client) };
}

const isMigrationBatch = (statements: { sql: string }[]) =>
  statements.some((s) => s.sql.includes(`"status" = 'applied', "finished_at"`));

const insertA = defineMigration({
  id: '001_insert_a',
  description: 'Insert a',
  destructive: false,
  statements: [{ sql: 'INSERT INTO "items" ("id", "n") VALUES (?, ?)', args: ['a', 1] }]
});

/** Statement 1 succeeds, 2 fails (missing table), 3 would succeed. */
const midFailure = defineMigration({
  id: '002_mid_failure',
  description: 'Fails in the middle',
  destructive: false,
  statements: [
    { sql: 'INSERT INTO "items" ("id", "n") VALUES (?, ?)', args: ['b', 2] },
    { sql: 'INSERT INTO "later" ("id") VALUES (?)', args: ['x'] },
    { sql: 'INSERT INTO "items" ("id", "n") VALUES (?, ?)', args: ['c', 3] }
  ]
});

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
}

describe('runSqliteMigrations — libSQL on disk (spec 072)', () => {
  it('bootstraps the ledger, applies once, and skips on a second run', async () => {
    const { executor, rows } = await setup();
    expect(await readSqliteMigrationHistory(executor)).toEqual([]);

    expect(await runSqliteMigrations(executor, [insertA])).toEqual([
      expect.objectContaining({ id: insertA.id, position: 1, outcome: 'applied' })
    ]);
    expect(await runSqliteMigrations(executor, [insertA])).toEqual([
      expect.objectContaining({ id: insertA.id, outcome: 'already-applied' })
    ]);
    expect(await rows()).toEqual([{ id: 'a', n: 1 }]);

    const [record] = await readSqliteMigrationHistory(executor);
    expect(record).toMatchObject({
      position: 1,
      id: insertA.id,
      status: 'applied',
      attempts: 1,
      failureCode: null
    });
    expect(record?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('mid-batch failure rolls everything back, records failed, refuses a plain rerun, retries on approval', async () => {
    const { client, executor, rows } = await setup();
    await runSqliteMigrations(executor, [insertA]);

    const failure = await runSqliteMigrations(executor, [insertA, midFailure]).catch(
      (e: unknown) => e
    );
    expect(failure).toMatchObject({
      name: 'MigrationError',
      code: 'MIGRATION_EXECUTION_FAILED',
      phase: 'execute',
      status: 'failed',
      migrationId: midFailure.id,
      position: 2
    });
    expect(await rows()).toEqual([{ id: 'a', n: 1 }]); // statement 1 rolled back, 3 never committed
    const history = await readSqliteMigrationHistory(executor);
    expect(history[1]).toMatchObject({ id: midFailure.id, status: 'failed', attempts: 1 });
    expect(history[1]?.failureCode).toMatch(/^[A-Z0-9_]+$/);

    expect(await codeOf(runSqliteMigrations(executor, [insertA, midFailure]))).toBe(
      'MIGRATION_RETRY_REQUIRED'
    );

    // The operator fixes the cause, then approves the retry of the same definition.
    await client.execute('CREATE TABLE "later" ("id" TEXT PRIMARY KEY)');
    const retried = await runSqliteMigrations(executor, [insertA, midFailure], {
      retryFailed: midFailure.id
    });
    expect(retried.map((r) => r.outcome)).toEqual(['already-applied', 'applied']);
    expect(await rows()).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'c', n: 3 }
    ]);
    expect((await readSqliteMigrationHistory(executor))[1]).toMatchObject({
      status: 'applied',
      attempts: 2,
      failureCode: null
    });
  });

  it('a corrected failed migration needs replaceFailed; editing it silently is a checksum mismatch', async () => {
    const { executor, rows } = await setup();
    await expect(runSqliteMigrations(executor, [midFailure])).rejects.toMatchObject({
      code: 'MIGRATION_EXECUTION_FAILED'
    });
    const corrected = defineMigration({
      ...midFailure,
      statements: [{ sql: 'INSERT INTO "items" ("id", "n") VALUES (?, ?)', args: ['b', 2] }]
    });
    expect(
      await codeOf(runSqliteMigrations(executor, [corrected], { retryFailed: midFailure.id }))
    ).toBe('MIGRATION_CHECKSUM_MISMATCH');
    const done = await runSqliteMigrations(executor, [corrected], {
      replaceFailed: midFailure.id
    });
    expect(done[0]?.outcome).toBe('applied');
    expect(await rows()).toEqual([{ id: 'b', n: 2 }]);
  });

  it('destructive migrations need allowDestructive; nothing runs without it, not even earlier ones', async () => {
    const { executor, rows } = await setup();
    const drop = defineMigration({
      id: '002_drop_n',
      description: 'Drop n',
      destructive: true,
      statements: [{ sql: 'ALTER TABLE "items" DROP COLUMN "n"' }]
    });
    const refusal = await runSqliteMigrations(executor, [insertA, drop]).catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: 'MIGRATION_REVIEW_REQUIRED', migrationId: drop.id });
    expect(await rows()).toEqual([]);
    expect(await readSqliteMigrationHistory(executor)).toEqual([]);

    const done = await runSqliteMigrations(executor, [insertA, drop], { allowDestructive: true });
    expect(done.map((r) => r.outcome)).toEqual(['applied', 'applied']);
  });

  it('lost response after commit: the fence conflicts, the ledger proves it applied → reconciled', async () => {
    const { client, rows } = await setup();
    let lost = false;
    const executor = executorOver(client, {
      async batch(send, statements) {
        await send();
        if (!lost && isMigrationBatch(statements)) {
          lost = true;
          throw new Error('fetch failed: socket hang up');
        }
      }
    });
    expect(await runSqliteMigrations(executor, [insertA])).toEqual([
      expect.objectContaining({ outcome: 'reconciled' })
    ]);
    expect(await rows()).toEqual([{ id: 'a', n: 1 }]);
    expect((await readSqliteMigrationHistory(executor))[0]?.status).toBe('applied');
  });

  it('lost request: the fence commits, so the attempt is known rolled back — and a late copy cannot commit', async () => {
    const { client, rows } = await setup();
    let late: (() => Promise<void>) | undefined;
    const executor = executorOver(client, {
      async batch(send, statements) {
        if (!late && isMigrationBatch(statements)) {
          late = send; // the request is "still in flight"
          throw new Error('fetch failed: timeout');
        }
        await send();
      }
    });
    const failure = await runSqliteMigrations(executor, [insertA]).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'MIGRATION_EXECUTION_FAILED', status: 'failed' });
    expect(await rows()).toEqual([]);

    // The in-flight batch finally arrives: its claim conflicts with the fence, nothing commits.
    await expect(late?.()).rejects.toThrow();
    expect(await rows()).toEqual([]);
    expect((await readSqliteMigrationHistory(executor))[0]).toMatchObject({ status: 'failed' });
  });

  /** An executor whose next migration batch is "lost in flight": it throws, and `late()` delivers it later. */
  function losingNextBatch(client: Client) {
    let late: (() => Promise<void>) | undefined;
    let armed = true;
    const executor = executorOver(client, {
      async batch(send, statements) {
        if (armed && isMigrationBatch(statements)) {
          armed = false;
          late = send;
          throw new Error('fetch failed: timeout');
        }
        await send();
      }
    });
    return { executor, late: () => (late ? late() : Promise.reject(new Error('nothing held'))) };
  }

  const needsLater = defineMigration({
    id: '001_needs_later',
    description: 'Writes into a table the operator creates later',
    destructive: false,
    statements: [{ sql: 'INSERT INTO "later" ("id") VALUES (?)', args: ['x'] }]
  });

  it('no ABA: a lost retry batch can never commit after a replace brings the row back (review finding)', async () => {
    const { client, executor } = await setup();
    const laterRows = async () =>
      (await client.execute(`SELECT COUNT(*) AS "n" FROM "later"`)).rows[0]?.n;
    expect(await codeOf(runSqliteMigrations(executor, [needsLater]))).toBe(
      'MIGRATION_EXECUTION_FAILED'
    ); // attempts 1

    // Runner A retries; its batch is lost in flight, its fence commits (attempts 2).
    const a = losingNextBatch(client);
    expect(
      await codeOf(runSqliteMigrations(a.executor, [needsLater], { retryFailed: needsLater.id }))
    ).toBe('MIGRATION_EXECUTION_FAILED');

    // Runner B replaces with the identical definition and fails too (attempts 3, never back to 1).
    expect(
      await codeOf(runSqliteMigrations(executor, [needsLater], { replaceFailed: needsLater.id }))
    ).toBe('MIGRATION_EXECUTION_FAILED');
    expect((await readSqliteMigrationHistory(executor))[0]?.attempts).toBe(3);

    // The operator fixes the cause; A's stale batch finally arrives and must not commit.
    await client.execute('CREATE TABLE "later" ("id" TEXT PRIMARY KEY)');
    await expect(a.late()).rejects.toThrow();
    expect(await laterRows()).toBe(0);
    expect((await readSqliteMigrationHistory(executor))[0]).toMatchObject({ status: 'failed' });

    // Only an explicit, fresh approval runs it — once.
    const done = await runSqliteMigrations(executor, [needsLater], { retryFailed: needsLater.id });
    expect(done[0]?.outcome).toBe('applied');
    expect(await laterRows()).toBe(1);
  });

  it('retry mode: lost request is fenced (late copy cannot commit); lost response reconciles', async () => {
    const { client, executor } = await setup();
    await expect(runSqliteMigrations(executor, [needsLater])).rejects.toBeDefined();
    await client.execute('CREATE TABLE "later" ("id" TEXT PRIMARY KEY)');

    const lost = losingNextBatch(client);
    expect(
      await codeOf(runSqliteMigrations(lost.executor, [needsLater], { retryFailed: needsLater.id }))
    ).toBe('MIGRATION_EXECUTION_FAILED');
    await expect(lost.late()).rejects.toThrow();
    expect((await client.execute('SELECT COUNT(*) AS "n" FROM "later"')).rows[0]?.n).toBe(0);

    let dropResponse = true;
    const lossy = executorOver(client, {
      async batch(send, statements) {
        await send();
        if (dropResponse && isMigrationBatch(statements)) {
          dropResponse = false;
          throw new Error('socket hang up');
        }
      }
    });
    const result = await runSqliteMigrations(lossy, [needsLater], { retryFailed: needsLater.id });
    expect(result[0]?.outcome).toBe('reconciled');
    expect((await client.execute('SELECT COUNT(*) AS "n" FROM "later"')).rows[0]?.n).toBe(1);
  });

  it('replace mode: a lost request is fenced and its late copy cannot commit', async () => {
    const { client, executor } = await setup();
    await expect(runSqliteMigrations(executor, [needsLater])).rejects.toBeDefined();
    await client.execute('CREATE TABLE "later" ("id" TEXT PRIMARY KEY)');
    const corrected = defineMigration({ ...needsLater, id: '001_needs_later_v2' });

    const lost = losingNextBatch(client);
    expect(
      await codeOf(
        runSqliteMigrations(lost.executor, [corrected], { replaceFailed: needsLater.id })
      )
    ).toBe('MIGRATION_EXECUTION_FAILED');
    await expect(lost.late()).rejects.toThrow();
    expect((await client.execute('SELECT COUNT(*) AS "n" FROM "later"')).rows[0]?.n).toBe(0);
    expect((await readSqliteMigrationHistory(executor))[0]).toMatchObject({
      id: corrected.id,
      status: 'failed',
      attempts: 2
    });
  });

  it('unreachable database: outcome unknown, no retry; the next run is safe', async () => {
    const { client, rows } = await setup();
    let down = false;
    const broken = executorOver(client, {
      async batch(send, statements) {
        if (down) throw new Error('connection refused');
        if (isMigrationBatch(statements)) {
          down = true;
          throw new Error('connection reset');
        }
        await send();
      },
      query() {
        if (down) throw new Error('connection refused');
      }
    });
    const failure = await runSqliteMigrations(broken, [insertA]).catch((e: unknown) => e);
    expect(failure).toMatchObject({
      code: 'MIGRATION_OUTCOME_UNKNOWN',
      phase: 'reconcile',
      status: 'unknown',
      migrationId: insertA.id
    });
    expect(String((failure as Error).message)).not.toContain('"a"');

    const healthy = executorOver(client);
    expect(await runSqliteMigrations(healthy, [insertA])).toEqual([
      expect.objectContaining({ outcome: 'applied' })
    ]);
    expect(await rows()).toEqual([{ id: 'a', n: 1 }]);
  });

  it('refuses to trust a ledger whose own schema drifted', async () => {
    const { client, executor } = await setup();
    await runSqliteMigrations(executor, [insertA]);
    await client.execute(`ALTER TABLE "${MIGRATION_LEDGER_TABLE}" ADD COLUMN "stray" TEXT`);
    expect(await codeOf(runSqliteMigrations(executor, [insertA]))).toBe(
      'MIGRATION_HISTORY_MISMATCH'
    );
  });

  it('never stores SQL arguments', async () => {
    const { client, executor } = await setup();
    const secret = defineMigration({
      id: '001_secret',
      description: 'Carries a value',
      destructive: false,
      statements: [
        { sql: 'INSERT INTO "items" ("id", "n") VALUES (?, ?)', args: ['secret-value', 7] }
      ]
    });
    await runSqliteMigrations(executor, [secret]);
    const dump = JSON.stringify(
      (await client.execute(`SELECT * FROM "${MIGRATION_LEDGER_TABLE}"`)).rows
    );
    expect(dump).not.toContain('secret-value');
    expect(dump).not.toContain('INSERT');
  });

  it('refuses a list that is not an exact extension of the history', async () => {
    const { executor } = await setup();
    const b: MigrationDefinition = { ...insertA, id: '002_b', statements: [{ sql: 'SELECT 2' }] };
    await runSqliteMigrations(executor, [insertA, b]);
    expect(await codeOf(runSqliteMigrations(executor, [b, insertA]))).toBe(
      'MIGRATION_HISTORY_MISMATCH'
    );
    expect(await codeOf(runSqliteMigrations(executor, [insertA]))).toBe(
      'MIGRATION_HISTORY_MISMATCH'
    );
  });
});
