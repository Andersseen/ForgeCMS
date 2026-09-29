import { describe, expect, it } from 'vitest';
import {
  canonicalMigration,
  defineMigration,
  migrationChecksum,
  planMigrationHistory,
  prepareMigrations,
  type MigrationDefinition,
  type MigrationRecord
} from './migrations.js';

// Spec 072 — the pure half of reviewed migrations: validation, checksums, history rules.

const rename: MigrationDefinition = {
  id: '20260929_001_posts_headline_to_title',
  description: 'Rename posts.headline to title',
  destructive: true,
  statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
};

function code(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
  return 'ok';
}

function withStatement(sql: string, args?: MigrationDefinition['statements'][number]['args']) {
  return {
    id: 'm1',
    description: 'd',
    destructive: false,
    statements: [{ sql, ...(args !== undefined && { args }) }]
  };
}

describe('defineMigration validation', () => {
  it('accepts a well-formed definition and freezes it', () => {
    const m = defineMigration(rename);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.statements[0])).toBe(true);
  });

  it.each([
    ['bad id', { ...rename, id: 'has space' }],
    ['empty id', { ...rename, id: '' }],
    ['empty description', { ...rename, description: '  ' }],
    ['missing destructive', { ...rename, destructive: undefined as unknown as boolean }],
    ['no statements and no resetBaseline', { ...rename, statements: [] }],
    [
      '41 statements',
      { ...rename, statements: Array.from({ length: 41 }, () => ({ sql: 'SELECT 1' })) }
    ]
  ])('refuses %s', (_label, definition) => {
    expect(code(() => defineMigration(definition as MigrationDefinition))).toBe(
      'MIGRATION_INVALID'
    );
  });

  it.each([
    ['two statements', 'UPDATE "a" SET "x" = 1; UPDATE "a" SET "y" = 2'],
    ['BEGIN', 'BEGIN TRANSACTION'],
    ['COMMIT', 'COMMIT'],
    ['VACUUM', 'VACUUM'],
    ['ATTACH', "ATTACH DATABASE 'x' AS y"],
    ['the ledger', 'UPDATE "_forge_migrations" SET "status" = \'applied\''],
    ['the baseline', 'DELETE FROM _FORGE_SCHEMA'],
    ['named params', 'UPDATE "a" SET "x" = :x'],
    ['numbered params', 'UPDATE "a" SET "x" = ?1'],
    ['$1 params', 'UPDATE "a" SET "x" = $1'],
    [':1 params', 'UPDATE "a" SET "x" = :1'],
    [
      'a trigger body (multiple statements)',
      'CREATE TRIGGER "t" AFTER INSERT ON "a" BEGIN SELECT 1; END'
    ],
    ['destructive:false DROP', 'DROP TABLE "a"'],
    ['destructive:false DELETE', 'DELETE FROM "a"'],
    ['destructive:false RENAME', 'ALTER TABLE "a" RENAME COLUMN "b" TO "c"'],
    ['destructive:false DROP COLUMN', 'ALTER TABLE "a" DROP COLUMN "b"'],
    ['empty sql', '   ']
  ])('refuses %s', (_label, sql) => {
    expect(code(() => defineMigration(withStatement(sql)))).toBe('MIGRATION_INVALID');
  });

  it('allows a trailing semicolon, comments, and semicolons inside literals and identifiers', () => {
    expect(
      code(() =>
        defineMigration(
          withStatement(`UPDATE "a;b" SET "x" = 'semi;colon' -- done;\n; /* trailing; */`)
        )
      )
    ).toBe('ok');
  });

  it('checks placeholder count and arg types', () => {
    expect(code(() => defineMigration(withStatement('UPDATE "a" SET "x" = ?', ['v'])))).toBe('ok');
    expect(code(() => defineMigration(withStatement('UPDATE "a" SET "x" = ?', [])))).toBe(
      'MIGRATION_INVALID'
    );
    expect(code(() => defineMigration(withStatement('UPDATE "a" SET "x" = \'?\'', ['v'])))).toBe(
      'MIGRATION_INVALID'
    );
    for (const bad of [Number.NaN, Infinity, undefined, {}, 1n]) {
      expect(
        code(() => defineMigration(withStatement('UPDATE "a" SET "x" = ?', [bad as never])))
      ).toBe('MIGRATION_INVALID');
    }
  });

  it('an UPDATE backfill may be non-destructive', () => {
    expect(
      code(() => defineMigration(withStatement('UPDATE "a" SET "x" = ? WHERE "x" IS NULL', ['v'])))
    ).toBe('ok');
  });

  it('validates resetBaseline; a baseline-only migration needs no SQL', () => {
    expect(code(() => defineMigration({ ...rename, resetBaseline: ['posts'] }))).toBe('ok');
    expect(
      code(() => defineMigration({ ...rename, statements: [], resetBaseline: ['posts'] }))
    ).toBe('ok');
    expect(code(() => defineMigration({ ...rename, resetBaseline: ['posts', 'posts'] }))).toBe(
      'MIGRATION_INVALID'
    );
    expect(code(() => defineMigration({ ...rename, resetBaseline: ['bad name'] }))).toBe(
      'MIGRATION_INVALID'
    );
  });

  it('refuses duplicate ids in one list', async () => {
    await expect(prepareMigrations([rename, rename])).rejects.toMatchObject({
      code: 'MIGRATION_INVALID'
    });
  });
});

describe('migrationChecksum', () => {
  it('golden: a fixed definition always hashes to the same value', async () => {
    expect(canonicalMigration(rename)).toBe(
      '["forge-migration",1,"20260929_001_posts_headline_to_title",true,[],' +
        '[["ALTER TABLE \\"posts\\" RENAME COLUMN \\"headline\\" TO \\"title\\"",[]]]]'
    );
    expect(await migrationChecksum(rename)).toBe(GOLDEN);
  });

  it('ignores the description; tracks everything that reaches the database', async () => {
    const baseline = await migrationChecksum(rename);
    expect(await migrationChecksum({ ...rename, description: 'typo fixed' })).toBe(baseline);
    expect(await migrationChecksum({ ...rename, destructive: false })).not.toBe(baseline);
    expect(await migrationChecksum({ ...rename, resetBaseline: ['posts'] })).not.toBe(baseline);
    expect(
      await migrationChecksum({
        ...rename,
        statements: [{ sql: 'ALTER TABLE "posts"  RENAME COLUMN "headline" TO "title"' }]
      })
    ).not.toBe(baseline);
  });

  it('types args, so "1", 1 and true differ', async () => {
    const m = (arg: string | number | boolean) =>
      migrationChecksum(withStatement('UPDATE "a" SET "x" = ?', [arg]));
    const sums = new Set([await m('1'), await m(1), await m(true)]);
    expect(sums.size).toBe(3);
  });

  it('resetBaseline order does not matter', async () => {
    expect(await migrationChecksum({ ...rename, resetBaseline: ['a', 'b'] })).toBe(
      await migrationChecksum({ ...rename, resetBaseline: ['b', 'a'] })
    );
  });
});

describe('planMigrationHistory', () => {
  const a = { ...rename, id: 'a', destructive: false, statements: [{ sql: 'SELECT 1' }] };
  const b = { ...a, id: 'b', statements: [{ sql: 'SELECT 2' }] };
  const c = { ...a, id: 'c', statements: [{ sql: 'SELECT 3' }] };

  async function rows(
    list: MigrationDefinition[],
    statuses: ('applied' | 'failed')[]
  ): Promise<MigrationRecord[]> {
    const prepared = await prepareMigrations(list);
    return statuses.map((status, i) => ({
      position: i + 1,
      id: prepared[i]!.definition.id,
      checksum: prepared[i]!.checksum,
      status,
      startedAt: 't',
      finishedAt: status === 'applied' ? 't' : null,
      attempts: 1,
      failureCode: status === 'failed' ? 'SQLITE_ERROR' : null
    }));
  }

  it('an exact prefix: applied, then pending', async () => {
    const plan = planMigrationHistory(
      await rows([a, b], ['applied', 'applied']),
      await prepareMigrations([a, b, c])
    );
    expect(plan.states.map((s) => s.state)).toEqual(['applied', 'applied', 'pending']);
    expect(plan.failed).toBeNull();
  });

  it('reordered, removed and divergent histories fail closed', async () => {
    const history = await rows([a, b], ['applied', 'applied']);
    for (const list of [[b, a], [b], [a], [a, c]]) {
      const prepared = await prepareMigrations(list);
      expect(code(() => planMigrationHistory(history, prepared))).toBe(
        'MIGRATION_HISTORY_MISMATCH'
      );
    }
  });

  it('an edited applied migration is a checksum mismatch', async () => {
    const history = await rows([a], ['applied']);
    const edited = await prepareMigrations([{ ...a, statements: [{ sql: 'SELECT 42' }] }]);
    expect(code(() => planMigrationHistory(history, edited))).toBe('MIGRATION_CHECKSUM_MISMATCH');
  });

  it('a failed last row is reported; an edited one needs replaceFailed', async () => {
    const history = await rows([a, b], ['applied', 'failed']);
    const plan = planMigrationHistory(history, await prepareMigrations([a, b]));
    expect(plan.failed?.id).toBe('b');
    expect(plan.states.map((s) => s.state)).toEqual(['applied', 'failed']);

    const fixed = await prepareMigrations([a, { ...b, statements: [{ sql: 'SELECT 22' }] }]);
    expect(code(() => planMigrationHistory(history, fixed))).toBe('MIGRATION_CHECKSUM_MISMATCH');
    const replaced = planMigrationHistory(history, fixed, { replaceFailed: 'b' });
    expect(replaced.states[1]?.state).toBe('pending');
    const renamed = await prepareMigrations([a, { ...b, id: 'b2' }]);
    expect(planMigrationHistory(history, renamed, { replaceFailed: 'b' }).states[1]?.state).toBe(
      'pending'
    );
  });

  it('a gap, or a failed row before an applied one, is a hand-edited ledger', async () => {
    const history = await rows([a, b], ['applied', 'applied']);
    expect(code(() => planMigrationHistory([{ ...history[1]!, position: 3 }], []))).toBe(
      'MIGRATION_HISTORY_MISMATCH'
    );
    const failedFirst = await rows([a, b], ['failed', 'applied']);
    expect(code(() => planMigrationHistory(failedFirst, []))).toBe('MIGRATION_HISTORY_MISMATCH');
  });
});

/** sha256 of the canonical string above, computed independently with node:crypto. */
const GOLDEN = 'a00258125b9a5712617029ec6823ce6e312b87371cade31f364d1a2d038e7e93';
