import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { runDatabaseAdapterAtomicWriteContractTests } from '@forge-cms/testing/contracts';
import { AtomicWriteConditionError, UniqueConstraintError } from '@forge-cms/db';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 060's real-D1 evidence: `D1DatabaseAdapter.atomicWrite` inside workerd against Miniflare's actual
// local D1 (SQLite) — not the hand-rolled SQL interpreter the unit-test mock uses.
//
// `@cloudflare/vitest-plugin` isolates storage per test *file*, not per `it()`, and the shared contract
// suite uses fixed table names, so they are emptied before every test. This `beforeEach` runs before the
// suite's own inner one (outer hooks first).
describe('D1DatabaseAdapter — real local D1 binding: atomic write batch contract (spec 060)', () => {
  beforeEach(async () => {
    for (const table of ['atomic_items', 'atomic_other']) {
      try {
        await env.DB.exec(`DELETE FROM "${table}"`);
      } catch {
        // Table doesn't exist yet on the first run in this file — fine.
      }
    }
  });

  runDatabaseAdapterAtomicWriteContractTests(() => new D1DatabaseAdapter().init(env));
});

describe('D1DatabaseAdapter — real local D1 binding: atomicWrite uses the native batch (spec 060)', () => {
  const notes = defineCollection({
    slug: 'atomic_native_notes',
    fields: { title: defineField.text(), tag: defineField.text({ unique: true }) }
  });

  /**
   * Counts how a write reaches D1. Statements are patched in place (own-property overrides on the real
   * prepared-statement objects) rather than proxied, because D1's `batch()` only accepts genuine
   * statements. While `seen.armed` is set, any execution of a statement outside `batch()` is recorded —
   * the adapter's own reads and schema bootstrap legitimately execute statements, so recording is
   * switched on only around the call under test.
   */
  function instrument() {
    const seen = { armed: false, batches: [] as number[], perStatement: [] as string[] };
    const real = env.DB;
    const patch = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
      for (const method of ['run', 'all', 'first', 'raw'] as const) {
        const original = statement[method].bind(statement) as (...args: unknown[]) => unknown;
        Object.defineProperty(statement, method, {
          value: (...args: unknown[]) => {
            if (seen.armed) seen.perStatement.push(`${method}: ${sql}`);
            return original(...args);
          }
        });
      }
      const bind = statement.bind.bind(statement);
      Object.defineProperty(statement, 'bind', {
        value: (...values: unknown[]) => patch(bind(...values), sql)
      });
      return statement;
    };
    const wrapped = new Proxy(real, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => patch(target.prepare(sql), sql);
        }
        if (property === 'batch') {
          return (statements: D1PreparedStatement[]) => {
            if (seen.armed) seen.batches.push(statements.length);
            return target.batch(statements);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    return { seen, adapter: new D1DatabaseAdapter().init({ DB: wrapped }) };
  }

  it('runs the whole batch as one db.batch() and never executes a statement on its own', async () => {
    const { seen, adapter } = instrument();
    await adapter.syncSchema([notes]);

    seen.armed = true;
    const results = await adapter.atomicWrite([
      { type: 'create', collection: 'atomic_native_notes', data: { id: 'n1', title: 'one' } },
      { type: 'update', collection: 'atomic_native_notes', id: 'n1', data: { title: 'two' } },
      { type: 'delete', collection: 'atomic_native_notes', id: 'absent' }
    ]);

    seen.armed = false;

    expect(results.map((r) => r.type)).toEqual(['create', 'update', 'delete']);
    expect(seen.perStatement).toEqual([]);
    // create + update + its must-apply guard + delete
    expect(seen.batches).toEqual([4]);
  });

  it('a rolled-back batch surfaces the typed errors and leaves nothing behind', async () => {
    const { adapter } = instrument();
    await adapter.syncSchema([notes]);
    await adapter.create('atomic_native_notes', { id: 'taken', title: 't', tag: 'dup' });

    await expect(
      adapter.atomicWrite([
        { type: 'create', collection: 'atomic_native_notes', data: { id: 'x', tag: 'fresh' } },
        { type: 'create', collection: 'atomic_native_notes', data: { id: 'y', tag: 'dup' } }
      ])
    ).rejects.toBeInstanceOf(UniqueConstraintError);
    await expect(
      adapter.atomicWrite([
        { type: 'create', collection: 'atomic_native_notes', data: { id: 'z', tag: 'zzz' } },
        { type: 'update', collection: 'atomic_native_notes', id: 'ghost', data: { title: 'no' } }
      ])
    ).rejects.toBeInstanceOf(AtomicWriteConditionError);

    expect(await adapter.findById('atomic_native_notes', 'x')).toBeNull();
    expect(await adapter.findById('atomic_native_notes', 'z')).toBeNull();
  });

  it('validates before sending: a bad operation never reaches batch()', async () => {
    const { seen, adapter } = instrument();
    await adapter.syncSchema([notes]);

    seen.armed = true;
    await expect(
      adapter.atomicWrite([
        { type: 'create', collection: 'atomic_native_notes', data: { id: 'ok' } },
        { type: 'create', collection: 'atomic_native_notes', data: { nonexistent: 1 } }
      ])
    ).rejects.toThrow("Unknown column 'nonexistent'");
    await expect(
      adapter.atomicWrite([{ type: 'create', collection: 'never_registered', data: {} }])
    ).rejects.toThrow("Collection 'never_registered' not registered");

    seen.armed = false;

    expect(seen.batches).toEqual([]);
    expect(seen.perStatement).toEqual([]);
    expect(await adapter.findById('atomic_native_notes', 'ok')).toBeNull();
  });
});
