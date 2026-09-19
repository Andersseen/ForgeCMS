import { beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';

// Duck-typed on purpose — like every other contract in this package it must not import
// `@forge-cms/db`, so this package's dependency graph stays `core`-only.

type Row = Record<string, unknown>;

interface ContractAtomicDatabaseAdapter {
  findById(collection: string, id: string): Promise<Row | null>;
  count(collection: string, where?: Row): Promise<number>;
  create(collection: string, data: Row): Promise<Row>;
  atomicWrite(operations: readonly Row[]): Promise<readonly unknown[]>;
  syncSchema(collections: unknown[]): Promise<void>;
}

export interface AtomicWriteContractOptions {
  /**
   * Whether the adapter rejects an unknown column / unregistered collection before writing anything.
   * True for the SQL adapters; `InMemoryDatabaseAdapter` (like all its methods) does not check either.
   * Default `true`.
   */
  rejectsUnknownColumns?: boolean;
}

const ITEMS = 'atomic_items';
const OTHER = 'atomic_other';
const MAX_OPERATIONS = 25;

const LAST_ADMIN = { keepAtLeast: { where: { role: 'admin' }, others: 1 } };

async function rejection(promise: Promise<unknown>): Promise<{ code?: unknown } & Error> {
  try {
    await promise;
  } catch (err) {
    return err as { code?: unknown } & Error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

/**
 * Proves the atomic write batch (spec 060) behaves identically on every `DatabaseAdapter`: all operations
 * commit or none does, results come back in order, later operations see earlier ones, conditional
 * operations reuse spec 059's `WriteCondition`, and invalid input never partially commits.
 *
 * Uses two fixed collections, `atomic_items` and `atomic_other` — an adapter over a persistent store must
 * be empty of both between tests (the InMemory/libSQL suites get that from a fresh adapter;
 * `packages/cloudflare/test/workers` clears the two tables in a `beforeEach`).
 */
export function runDatabaseAdapterAtomicWriteContractTests(
  createAdapter: () => ContractAtomicDatabaseAdapter,
  options: AtomicWriteContractOptions = {}
) {
  const rejectsUnknownColumns = options.rejectsUnknownColumns ?? true;

  describe('DatabaseAdapter atomic write contract (spec 060)', () => {
    let adapter: ContractAtomicDatabaseAdapter;

    const items = defineCollection({
      slug: ITEMS,
      fields: {
        email: defineField.text({ required: true, unique: true }),
        name: defineField.text(),
        role: defineField.text(),
        qty: defineField.number(),
        active: defineField.boolean(),
        meta: defineField.json()
      }
    });
    const other = defineCollection({
      slug: OTHER,
      fields: { label: defineField.text({ unique: true }) }
    });

    /** Results are duck-typed: the real `AtomicWriteResult` union is not assignable to a string-keyed record. */
    const write = async (operations: readonly Row[]): Promise<Row[]> =>
      (await adapter.atomicWrite(operations)) as Row[];

    beforeEach(async () => {
      adapter = createAdapter();
      await adapter.syncSchema([items, other]);
    });

    // --- operation builders ------------------------------------------------------------------------
    const create = (id: string, extra: Row = {}): Row => ({
      type: 'create',
      collection: ITEMS,
      data: { id, email: `${id}@example.com`, ...extra }
    });
    const update = (id: string, data: Row): Row => ({
      type: 'update',
      collection: ITEMS,
      id,
      data
    });
    const remove = (id: string): Row => ({ type: 'delete', collection: ITEMS, id });
    const updateIf = (id: string, data: Row, condition: Row, requireApplied?: boolean): Row => ({
      type: 'updateIf',
      collection: ITEMS,
      id,
      data,
      condition,
      ...(requireApplied !== undefined && { requireApplied })
    });
    const deleteIf = (id: string, condition: Row, requireApplied?: boolean): Row => ({
      type: 'deleteIf',
      collection: ITEMS,
      id,
      condition,
      ...(requireApplied !== undefined && { requireApplied })
    });
    /** Fails on every adapter, *after* whatever precedes it ran: a plain update of a row that is not there. */
    const FAILING_UPDATE = update('ghost', { name: 'never' });

    const seed = (id: string, extra: Row = {}) =>
      adapter.create(ITEMS, create(id, extra).data as Row);
    const exists = async (id: string) => (await adapter.findById(ITEMS, id)) !== null;
    const field = async (id: string, name: string) => (await adapter.findById(ITEMS, id))?.[name];

    // --- commit, order, results --------------------------------------------------------------------
    describe('commit and results', () => {
      it('an empty batch returns [] and changes nothing', async () => {
        expect(await write([])).toEqual([]);
      });

      it('commits every operation and returns one result per operation, in input order', async () => {
        await seed('b', { name: 'b0' });

        const results = await write([
          create('a', { name: 'a1' }),
          update('a', { name: 'a2' }),
          updateIf('a', { role: 'lead' }, { targetMatches: { name: 'a2' } }),
          deleteIf('b', { targetMatches: { name: 'b0' } }),
          remove('nothing-here')
        ]);

        expect(results.map((r) => r.type)).toEqual([
          'create',
          'update',
          'updateIf',
          'deleteIf',
          'delete'
        ]);
        expect((results[0]?.record as Row).id).toBe('a');
        expect((results[1]?.record as Row).name).toBe('a2');
        expect(results[2]).toMatchObject({ type: 'updateIf', applied: true });
        expect(results[3]).toEqual({ type: 'deleteIf', applied: true });
        expect(results[4]).toEqual({ type: 'delete' });

        expect(await field('a', 'name')).toBe('a2');
        expect(await field('a', 'role')).toBe('lead');
        expect(await exists('b')).toBe(false);
      });

      it('creates across collections in one batch', async () => {
        await write([
          create('a'),
          { type: 'create', collection: OTHER, data: { id: 'o1', label: 'first' } }
        ]);
        expect(await exists('a')).toBe(true);
        expect(await adapter.findById(OTHER, 'o1')).not.toBeNull();
      });

      it('returns records hydrated exactly as the single calls do', async () => {
        const [result] = await write([
          create('h', { name: 'H', qty: 3, active: true, meta: { nested: [1, 2] } })
        ]);
        const record = result?.record as Row;

        expect(record).toMatchObject({ id: 'h', qty: 3, active: true, meta: { nested: [1, 2] } });
        expect(await adapter.findById(ITEMS, 'h')).toEqual(record);

        const [updated] = await write([update('h', { active: false, meta: { z: 1 } })]);
        expect(updated?.record).toMatchObject({ active: false, meta: { z: 1 } });
        expect(await adapter.findById(ITEMS, 'h')).toEqual(updated?.record);
      });

      it('generates an id when none is supplied and reports it', async () => {
        const [result] = await write([
          { type: 'create', collection: ITEMS, data: { email: 'noid@example.com' } }
        ]);
        const id = (result?.record as Row).id;
        expect(typeof id).toBe('string');
        expect(await exists(String(id))).toBe(true);
      });

      it('stamps timestamps on create; update refreshes updated_at and keeps created_at', async () => {
        const [created] = await write([create('t')]);
        const record = created?.record as Row;
        expect(Number.isNaN(Date.parse(String(record.created_at)))).toBe(false);
        expect(Number.isNaN(Date.parse(String(record.updated_at)))).toBe(false);

        const [updated] = await write([update('t', { name: 'later' })]);
        const after = updated?.record as Row;
        expect(after.created_at).toBe(record.created_at);
        expect(Date.parse(String(after.updated_at))).toBeGreaterThanOrEqual(
          Date.parse(String(record.updated_at))
        );
      });

      it('never lets update rewrite the id', async () => {
        await seed('keep', { name: 'x' });
        await write([update('keep', { id: 'hijacked', name: 'y' })]);
        expect(await exists('hijacked')).toBe(false);
        expect(await field('keep', 'name')).toBe('y');
      });
    });

    describe('ordered visibility', () => {
      it('a later operation sees what an earlier one wrote', async () => {
        await write([
          create('o', { qty: 1 }),
          update('o', { qty: 2 }),
          // Only holds if the update above is already visible:
          updateIf('o', { role: 'saw-qty-2' }, { targetMatches: { qty: 2 } }, true)
        ]);
        expect(await field('o', 'role')).toBe('saw-qty-2');
      });

      it('a row created and deleted in one batch never exists afterwards', async () => {
        await write([create('gone'), remove('gone')]);
        expect(await exists('gone')).toBe(false);
      });

      it('a keepAtLeast guard sees earlier operations of the same batch', async () => {
        await seed('a1', { role: 'admin' });
        await seed('a2', { role: 'admin' });

        // Each demotion alone is allowed; the second sees the first and must be refused.
        const error = await rejection(
          write([
            updateIf('a1', { role: 'editor' }, LAST_ADMIN, true),
            updateIf('a2', { role: 'editor' }, LAST_ADMIN, true)
          ])
        );
        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await field('a1', 'role')).toBe('admin');
        expect(await field('a2', 'role')).toBe('admin');
      });
    });

    // --- rollback ----------------------------------------------------------------------------------
    describe('rollback', () => {
      it('create + a conflicting create: neither exists afterwards', async () => {
        await seed('taken', { email: 'shared@example.com' });

        const error = await rejection(
          write([create('fresh'), create('clash', { email: 'shared@example.com' })])
        );

        expect(error.code).toBe('UNIQUE_CONSTRAINT');
        expect((error as { collection?: string }).collection).toBe(ITEMS);
        expect(await exists('fresh')).toBe(false);
        expect(await exists('clash')).toBe(false);
        expect(await exists('taken')).toBe(true);
      });

      it('two creates that conflict with each other inside the batch: neither exists', async () => {
        const error = await rejection(
          write([
            create('one', { email: 'same@example.com' }),
            create('two', { email: 'same@example.com' })
          ])
        );
        expect(error.code).toBe('UNIQUE_CONSTRAINT');
        expect(await exists('one')).toBe(false);
        expect(await exists('two')).toBe(false);
      });

      it('names the collection that conflicted when the batch spans collections', async () => {
        await adapter.create(OTHER, { id: 'o1', label: 'claimed' });

        const error = await rejection(
          write([
            create('would-be-fine'),
            { type: 'create', collection: OTHER, data: { id: 'o2', label: 'claimed' } }
          ])
        );

        expect(error.code).toBe('UNIQUE_CONSTRAINT');
        expect((error as { collection?: string }).collection).toBe(OTHER);
        expect(await exists('would-be-fine')).toBe(false);
      });

      it('update + a failing operation: the row keeps its original value', async () => {
        await seed('u', { name: 'original' });
        await rejection(write([update('u', { name: 'changed' }), FAILING_UPDATE]));
        expect(await field('u', 'name')).toBe('original');
      });

      it('delete + a failing operation: the row still exists', async () => {
        await seed('d', { name: 'still-here' });
        await rejection(write([remove('d'), FAILING_UPDATE]));
        expect(await exists('d')).toBe(true);
      });

      it('conditional write + a failing operation: nothing changes', async () => {
        await seed('c', { qty: 1 });
        await rejection(
          write([
            updateIf('c', { qty: 2 }, { targetMatches: { qty: 1 } }),
            deleteIf('c', {}),
            FAILING_UPDATE
          ])
        );
        expect(await field('c', 'qty')).toBe(1);
        expect(await exists('c')).toBe(true);
      });

      it('rolls back across collections (a claim-and-record shape)', async () => {
        await rejection(
          write([
            { type: 'create', collection: OTHER, data: { id: 'claim', label: 'slot' } },
            create('owner'),
            FAILING_UPDATE
          ])
        );
        expect(await adapter.findById(OTHER, 'claim')).toBeNull();
        expect(await exists('owner')).toBe(false);
      });

      it('an operation after the failing one is never applied', async () => {
        await seed('taken', { email: 'shared@example.com' });
        await rejection(write([create('clash', { email: 'shared@example.com' }), create('after')]));
        expect(await exists('after')).toBe(false);
      });

      it('the adapter is fully usable after a rolled-back batch (no transaction left open)', async () => {
        await seed('taken', { email: 'shared@example.com' });
        await rejection(write([create('x'), create('y', { email: 'shared@example.com' })]));

        await write([create('x'), create('y')]);
        expect(await exists('x')).toBe(true);
        expect(await exists('y')).toBe(true);
        expect(await adapter.count(ITEMS)).toBe(3);
      });
    });

    // --- missing targets ---------------------------------------------------------------------------
    describe('missing targets', () => {
      it('update of a missing row fails the batch with AtomicWriteConditionError and rolls back', async () => {
        const error = await rejection(write([create('early'), FAILING_UPDATE]));
        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await exists('early')).toBe(false);
      });

      it('delete of a missing row is a successful no-op and the rest of the batch commits', async () => {
        const results = await write([remove('nobody'), create('kept')]);
        expect(results[0]).toEqual({ type: 'delete' });
        expect(await exists('kept')).toBe(true);
      });
    });

    // --- conditional operations --------------------------------------------------------------------
    describe('conditional operations (spec 059 WriteCondition)', () => {
      it('applied: true reports the record as written', async () => {
        await seed('v', { qty: 1 });
        const [result] = await write([updateIf('v', { qty: 2 }, { targetMatches: { qty: 1 } })]);
        expect(result).toMatchObject({ type: 'updateIf', applied: true });
        expect((result as { record: Row }).record).toMatchObject({ id: 'v', qty: 2 });
        expect(await adapter.findById(ITEMS, 'v')).toEqual((result as { record: Row }).record);
      });

      it('applied: false is a valid result and the rest of the batch still commits', async () => {
        await seed('v', { qty: 1 });
        await seed('w', { qty: 1 });

        const results = await write([
          updateIf('v', { qty: 9 }, { targetMatches: { qty: 99 } }),
          updateIf('ghost', { qty: 9 }, {}),
          deleteIf('w', { targetMatches: { qty: 99 } }),
          deleteIf('ghost', {}),
          create('other-work')
        ]);

        expect(results.map((r) => (r as { applied?: boolean }).applied)).toEqual([
          false,
          false,
          false,
          false,
          undefined
        ]);
        expect(await field('v', 'qty')).toBe(1);
        expect(await exists('w')).toBe(true);
        expect(await exists('other-work')).toBe(true);
      });

      it('requireApplied on an updateIf that does not apply fails the whole batch', async () => {
        await seed('v', { qty: 1 });

        const error = await rejection(
          write([
            create('before'),
            updateIf('v', { qty: 2 }, { targetMatches: { qty: 99 } }, true),
            create('after')
          ])
        );

        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await exists('before')).toBe(false);
        expect(await exists('after')).toBe(false);
        expect(await field('v', 'qty')).toBe(1);
      });

      it('requireApplied on a missing target fails the whole batch', async () => {
        const error = await rejection(
          write([create('before'), updateIf('ghost', { qty: 1 }, {}, true)])
        );
        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await exists('before')).toBe(false);
      });

      it('requireApplied on a deleteIf that does not apply fails the whole batch', async () => {
        await seed('keep', { qty: 1 });
        const error = await rejection(
          write([create('before'), deleteIf('keep', { targetMatches: { qty: 2 } }, true)])
        );
        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await exists('before')).toBe(false);
        expect(await exists('keep')).toBe(true);
      });

      it('requireApplied does not get in the way when the operation applies', async () => {
        await seed('v', { qty: 1 });
        await write([
          updateIf('v', { qty: 2 }, { targetMatches: { qty: 1 } }, true),
          deleteIf('v', { targetMatches: { qty: 2 } }, true),
          create('after')
        ]);
        expect(await exists('v')).toBe(false);
        expect(await exists('after')).toBe(true);
      });

      it('requireApplied: false behaves like the default', async () => {
        const [result] = await write([updateIf('ghost', { qty: 1 }, {}, false)]);
        expect(result).toEqual({ type: 'updateIf', applied: false });
      });

      it('a keepAtLeast guard protects the last member: the batch fails and nothing else commits', async () => {
        await seed('a1', { role: 'admin' });
        await seed('a2', { role: 'admin' });

        await write([deleteIf('a1', LAST_ADMIN, true), create('audit-1', { name: 'removed a1' })]);
        expect(await exists('a1')).toBe(false);
        expect(await exists('audit-1')).toBe(true);

        const error = await rejection(
          write([deleteIf('a2', LAST_ADMIN, true), create('audit-2', { name: 'removed a2' })])
        );
        expect(error.code).toBe('ATOMIC_WRITE_CONDITION_FAILED');
        expect(await exists('a2')).toBe(true);
        expect(await exists('audit-2')).toBe(false);
      });

      it('a failed condition wins over a would-be unique conflict (applied: false, no error)', async () => {
        await seed('x1', { role: 'editor' });
        await seed('x2', { role: 'editor' });

        const [result] = await write([
          updateIf('x2', { email: 'x1@example.com' }, { targetMatches: { role: 'nobody' } })
        ]);
        expect(result).toEqual({ type: 'updateIf', applied: false });
      });

      it('a unique conflict on a write whose condition holds fails the batch and persists nothing', async () => {
        await seed('x1', { role: 'editor' });
        await seed('x2', { role: 'editor', name: 'before' });

        const error = await rejection(
          write([
            create('extra'),
            updateIf(
              'x2',
              { email: 'x1@example.com', name: 'after' },
              { targetMatches: { role: 'editor' } }
            )
          ])
        );
        expect(error.code).toBe('UNIQUE_CONSTRAINT');
        expect(await exists('extra')).toBe(false);
        expect(await field('x2', 'name')).toBe('before');
      });
    });

    // --- invalid input -----------------------------------------------------------------------------
    describe('invalid input never partially commits', () => {
      it(`accepts exactly ${MAX_OPERATIONS} operations and rejects more, before writing anything`, async () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => create(`bulk-${i}`));

        await write(many(MAX_OPERATIONS));
        expect(await adapter.count(ITEMS)).toBe(MAX_OPERATIONS);

        const error = await rejection(
          write(Array.from({ length: MAX_OPERATIONS + 1 }, (_, i) => create(`over-${i}`)))
        );
        expect(error).toBeInstanceOf(RangeError);
        expect(await exists('over-0')).toBe(false);
        expect(await adapter.count(ITEMS)).toBe(MAX_OPERATIONS);
      });

      it('rejects an unknown operation type after valid ones, applying none', async () => {
        const error = await rejection(
          write([create('valid'), { type: 'upsert', collection: ITEMS, data: {} }])
        );
        expect(error).toBeInstanceOf(TypeError);
        expect(await exists('valid')).toBe(false);
      });

      it('rejects malformed operations, applying none', async () => {
        const malformed: Row[] = [
          { type: 'create', data: { email: 'x@example.com' } }, // no collection
          { type: 'update', collection: ITEMS, data: { name: 'x' } }, // no id
          { type: 'create', collection: ITEMS, data: 'nope' }, // data not an object
          { type: 'deleteIf', collection: ITEMS, id: 'a' } // no condition
        ];
        for (const bad of malformed) {
          const error = await rejection(write([create('valid'), bad]));
          expect(error).toBeInstanceOf(TypeError);
          expect(await exists('valid')).toBe(false);
        }
      });

      it('rejects a non-array argument', async () => {
        const error = await rejection((write as (ops: unknown) => Promise<Row[]>)(create('x')));
        expect(error).toBeInstanceOf(TypeError);
      });

      for (const others of [-1, 1.5, Number.NaN, undefined as unknown as number]) {
        it(`rejects keepAtLeast.others = ${others} in a later operation, applying none`, async () => {
          await seed('a', { role: 'admin' });
          const bad = { keepAtLeast: { where: { role: 'admin' }, others } };

          const error = await rejection(
            write([create('valid'), updateIf('a', { role: 'editor' }, bad)])
          );
          expect(error).toBeInstanceOf(RangeError);
          expect(await exists('valid')).toBe(false);
          expect(await field('a', 'role')).toBe('admin');
        });
      }

      if (rejectsUnknownColumns) {
        it('rejects an unknown column in a later operation, applying none', async () => {
          await rejection(write([create('valid'), create('bad', { nonexistent: 1 })]));
          expect(await exists('valid')).toBe(false);
          expect(await exists('bad')).toBe(false);
        });

        it('rejects an unregistered collection in a later operation, applying none', async () => {
          await rejection(
            write([
              create('valid'),
              { type: 'create', collection: 'never_registered', data: { id: 'z' } }
            ])
          );
          expect(await exists('valid')).toBe(false);
        });
      }
    });

    // --- independent writers -----------------------------------------------------------------------
    describe('racing batches', () => {
      it('two batches claiming the same unique key: exactly one commits, the loser leaves nothing', async () => {
        const claim = (owner: string): Row[] => [
          { type: 'create', collection: OTHER, data: { label: 'the-slot' } },
          create(owner)
        ];

        const results = await Promise.allSettled([write(claim('p1')), write(claim('p2'))]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const loser = results.find((r) => r.status === 'rejected');
        expect((loser as PromiseRejectedResult).reason).toMatchObject({
          code: 'UNIQUE_CONSTRAINT'
        });
        expect(await adapter.count(OTHER)).toBe(1);
        // Exactly the winner's own row exists — the loser's row rolled back with its claim.
        expect(await adapter.count(ITEMS)).toBe(1);
      });

      it('a compare-and-set document write racing with its dependent insert: one snapshot, not two', async () => {
        await seed('doc', { qty: 1 });
        const bump = (snapshot: string): Row[] => [
          updateIf('doc', { qty: 2 }, { targetMatches: { qty: 1 } }, true),
          create(snapshot, { name: `snapshot of doc by ${snapshot}` })
        ];

        const results = await Promise.allSettled([write(bump('s1')), write(bump('s2'))]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const loser = results.find((r) => r.status === 'rejected');
        expect((loser as PromiseRejectedResult).reason).toMatchObject({
          code: 'ATOMIC_WRITE_CONDITION_FAILED'
        });
        expect(await field('doc', 'qty')).toBe(2);
        // The document changed once, and exactly one snapshot exists to say so.
        expect((await exists('s1')) !== (await exists('s2'))).toBe(true);
      });
    });
  });
}
