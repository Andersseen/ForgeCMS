import { describe, expect, it } from 'vitest';
import { createWriteGate, type WriteGate } from './last-admin.js';

// Document / version-history consistency contract (spec 062). Duck-typed on purpose — like every other
// contract in this package it must not import `@forge-cms/runtime`/`@forge-cms/db`.

/** The subset of the runtime's public `Version` shape the suite reads. */
export interface VersionHistoryVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  data: Record<string, unknown>;
  label?: string;
}

/** The subset of `ForgeCmsRuntime`'s Local API under test (trusted calls; `overrideAccess` defaults to true). */
export interface VersionHistoryRuntime {
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  listVersions(args: { collection: string; documentId: string }): Promise<VersionHistoryVersion[]>;
  restoreVersion(args: { collection: string; versionId: string }): Promise<Record<string, unknown>>;
  createVersion(args: {
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    label?: string;
  }): Promise<VersionHistoryVersion>;
}

/** Raw, **ungated** database access to the same store, for seeding and for reading what really committed. */
export interface VersionHistoryDatabase {
  create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  findMany(options: {
    collection: string;
    where?: Record<string, unknown>;
  }): Promise<Record<string, unknown>[]>;
}

export interface VersionHistoryHarness {
  /** `parties` runtimes, each over its **own adapter instance** (own client/connection), all over one store, every database wrapped with `gate.wrap(...)`. */
  contenders: VersionHistoryRuntime[];
  database: VersionHistoryDatabase;
}

/**
 * Builds the harness. Every contender's runtime must register (and `syncSchema()`) exactly this
 * collection, with the version table the runtime creates for it:
 *
 * ```ts
 * defineCollection({
 *   slug: collection,
 *   versions: true,
 *   fields: {
 *     title: defineField.text({ required: true }),
 *     body: defineField.text(),
 *     tag: defineField.text()
 *   }
 * })
 * ```
 */
export type VersionHistoryHarnessFactory = (options: {
  /** A collection slug no other test has used, so a persistent shared store needs no cleanup. */
  collection: string;
  parties: number;
  gate: WriteGate;
}) => Promise<VersionHistoryHarness>;

export interface VersionHistoryContractOptions {
  /**
   * SQL backends: make every insert into `versionsCollection` fail inside the database with an error
   * that is **not** a constraint violation (e.g. a `BEFORE INSERT` trigger that raises). Returns an undo.
   * Proves rollback for arbitrary snapshot failures, not only for the unique index. Omit on InMemory.
   */
  failSnapshotInserts?: (versionsCollection: string) => Promise<() => Promise<void>>;
}

const TEST_TIMEOUT_MS = 30_000;

const WRITE_METHODS = new Set([
  'create',
  'update',
  'updateIf',
  'delete',
  'deleteIf',
  'atomicWrite'
]);

/**
 * A {@link WriteGate} that can also run one action immediately before the next write any wrapped
 * database makes — i.e. after the operation has done every read it does. That is how a snapshot
 * collision is injected *inside* a versioned update's batch deterministically: the conflicting row
 * appears after the writer observed the latest version number and before its batch reaches the database.
 */
function createInterceptingGate(): WriteGate & {
  beforeNextWrite(action: () => Promise<unknown>): void;
} {
  const gate = createWriteGate();
  let pending: (() => Promise<unknown>) | undefined;
  return {
    wrap<T extends object>(database: T): T {
      const intercepted = new Proxy(database, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          if (typeof property === 'string' && WRITE_METHODS.has(property)) {
            return async (...args: unknown[]) => {
              const action = pending;
              pending = undefined;
              if (action) await action();
              return method.apply(target, args);
            };
          }
          return method.bind(target);
        }
      });
      return gate.wrap(intercepted);
    },
    arm: (parties) => gate.arm(parties),
    disarm: () => gate.disarm(),
    get arrivals() {
      return gate.arrivals;
    },
    beforeNextWrite(action) {
      pending = action;
    }
  };
}
let collectionCounter = 0;

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to reject, but it succeeded');
}

/**
 * Proves, on one backend, that a versioned document and its history cannot diverge: create/update/
 * restore write the document and its snapshot in one atomic batch, version identity is unique in the
 * database, and two writers racing against the same history state produce one success and one
 * `CONCURRENT_MODIFICATION` — never two silent successes. Snapshot failures are injected **inside** the
 * batch (a pre-seeded row that collides on the unique index, or `failSnapshotInserts`), and the state is
 * then read back from the database — rollback is never inferred from the thrown error alone.
 */
export function runVersionHistoryContractTests(
  setup: VersionHistoryHarnessFactory,
  options: VersionHistoryContractOptions = {}
) {
  describe('document / version history consistency (spec 062)', () => {
    async function prepare(parties = 1) {
      const collection = `version_history_${++collectionCounter}`;
      const versions = `_versions_${collection}`;
      const gate = createInterceptingGate();
      const harness = await setup({ collection, parties, gate });
      const [first] = harness.contenders;
      if (!first || harness.contenders.length !== parties) {
        throw new Error(`setup() must return exactly ${parties} contenders`);
      }

      const rowOf = async (id: string) => {
        const [row] = await harness.database.findMany({ collection, where: { id } });
        return row;
      };
      const historyOf = async (documentId: string) =>
        (await first.listVersions({ collection, documentId })).map((v) => ({
          versionNumber: v.versionNumber,
          data: v.data,
          label: v.label
        }));
      /** A version row written straight to the table — a snapshot "someone else" already committed. */
      const plantVersion = (documentId: string, versionNumber: number) =>
        harness.database.create(versions, {
          id: `planted-${documentId}-${versionNumber}`,
          documentId,
          versionNumber,
          data: JSON.stringify({ title: 'planted' }),
          createdAt: new Date().toISOString()
        });

      return { collection, versions, gate, first, harness, rowOf, historyOf, plantVersion };
    }

    it(
      'version identity (documentId, versionNumber) is unique in the database; other documents are independent',
      async () => {
        const { first, collection, versions, harness } = await prepare();
        const doc = await first.create({ collection, data: { title: 'one' } });
        const documentId = doc.id as string;

        const duplicate = await rejection(
          harness.database.create(versions, {
            id: 'dup',
            documentId,
            versionNumber: 1,
            data: '{}',
            createdAt: new Date().toISOString()
          })
        );
        expect(codeOf(duplicate)).toBe('UNIQUE_CONSTRAINT');

        await harness.database.create(versions, {
          id: 'other-doc-v1',
          documentId: 'some-other-document',
          versionNumber: 1,
          data: '{}',
          createdAt: new Date().toISOString()
        });
        expect(
          await harness.database.findMany({ collection: versions, where: { documentId } })
        ).toHaveLength(1);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'create: a failing version-1 insert rolls back the document insert of the same batch',
      async () => {
        const { first, collection, rowOf, historyOf, plantVersion } = await prepare();
        const id = `fixed-${collection}`;
        await plantVersion(id, 1);

        const error = await rejection(
          first.create({ collection, data: { id, title: 'never', body: 'b' } })
        );
        expect(codeOf(error)).toBe('UNIQUE_CONSTRAINT');
        // The internal version table is never named to the caller.
        expect(String((error as Error).message)).not.toContain('_versions_');
        expect(JSON.stringify(error)).not.toContain('_versions_');

        expect(await rowOf(id)).toBeUndefined();
        expect((await historyOf(id)).map((v) => v.data.title)).toEqual(['planted']);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'update: a failing snapshot insert rolls back the document update of the same batch',
      async () => {
        const { first, gate, collection, rowOf, historyOf, plantVersion } = await prepare();
        const doc = await first.create({ collection, data: { title: 'v1', body: 'b' } });
        const id = doc.id as string;
        // Another writer's version 2 lands after this update read "latest = 1", before its batch.
        gate.beforeNextWrite(() => plantVersion(id, 2));

        const error = await rejection(first.update({ collection, id, data: { title: 'v2' } }));
        expect(codeOf(error)).toBe('CONCURRENT_MODIFICATION');

        expect((await rowOf(id))?.title).toBe('v1');
        expect((await historyOf(id)).map((v) => v.versionNumber)).toEqual([2, 1]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'restore: a failing labeled snapshot rolls back the restored document',
      async () => {
        const { first, gate, collection, rowOf, historyOf, plantVersion } = await prepare();
        const doc = await first.create({ collection, data: { title: 'Original', body: 'b' } });
        const id = doc.id as string;
        await first.update({ collection, id, data: { title: 'Changed' } });
        const [, v1] = await first.listVersions({ collection, documentId: id });
        gate.beforeNextWrite(() => plantVersion(id, 3));

        const error = await rejection(first.restoreVersion({ collection, versionId: v1!.id }));
        expect(codeOf(error)).toBe('CONCURRENT_MODIFICATION');

        expect((await rowOf(id))?.title).toBe('Changed');
        expect((await historyOf(id)).map((v) => v.versionNumber)).toEqual([3, 2, 1]);
      },
      TEST_TIMEOUT_MS
    );

    if (options.failSnapshotInserts) {
      const failSnapshotInserts = options.failSnapshotInserts;

      it(
        'create/update/restore: a non-constraint database failure of the snapshot insert rolls back the document',
        async () => {
          const { first, collection, versions, rowOf, historyOf } = await prepare();
          const doc = await first.create({ collection, data: { title: 'kept', body: 'b' } });
          const id = doc.id as string;
          await first.update({ collection, id, data: { title: 'kept too' } });
          const [, v1] = await first.listVersions({ collection, documentId: id });

          const undo = await failSnapshotInserts(versions);
          try {
            const newId = `never-${collection}`;
            await rejection(first.create({ collection, data: { id: newId, title: 'never' } }));
            await rejection(first.update({ collection, id, data: { title: 'never' } }));
            await rejection(first.restoreVersion({ collection, versionId: v1!.id }));

            expect(await rowOf(newId)).toBeUndefined();
            expect(await historyOf(newId)).toEqual([]);
            expect((await rowOf(id))?.title).toBe('kept too');
            expect((await historyOf(id)).map((v) => v.versionNumber)).toEqual([2, 1]);
          } finally {
            await undo();
          }
        },
        TEST_TIMEOUT_MS
      );
    }

    it(
      'control: the harness routes the versioned write path through the gate',
      async () => {
        const { gate, harness, collection, first } = await prepare(2);
        const doc = await first.create({ collection, data: { title: 'v1' } });
        const [a, b] = harness.contenders;

        gate.arm(2);
        try {
          // Only one writer arrives: it must be held, i.e. the harness gates the versioned write path.
          let settled = false;
          const pending = a!.update({ collection, id: doc.id as string, data: { title: 'A' } });
          void pending.then(
            () => (settled = true),
            () => (settled = true)
          );
          await new Promise((resolve) => setTimeout(resolve, 50));
          expect(settled).toBe(false);
          expect(gate.arrivals).toBe(1);
          // Release it with a second party that writes something unrelated.
          await b!.create({ collection, data: { title: 'unrelated' } });
          await pending;
        } finally {
          gate.disarm();
        }
      },
      TEST_TIMEOUT_MS
    );

    it(
      'two writers updating the same history state: exactly one commits, the other gets CONCURRENT_MODIFICATION and wrote nothing',
      async () => {
        const { gate, harness, collection, first, rowOf, historyOf } = await prepare(2);
        const doc = await first.create({
          collection,
          data: { title: 'v1', body: 'shared body', tag: 'keep' }
        });
        const id = doc.id as string;
        const [a, b] = harness.contenders;

        gate.arm(2);
        let results: PromiseSettledResult<Record<string, unknown>>[];
        try {
          results = await Promise.allSettled([
            a!.update({ collection, id, data: { title: 'A' } }),
            b!.update({ collection, id, data: { title: 'B' } })
          ]);
        } finally {
          gate.disarm();
        }

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(codeOf(rejected[0]!.reason)).toBe('CONCURRENT_MODIFICATION');

        const winner = results[0]!.status === 'fulfilled' ? 'A' : 'B';
        const row = await rowOf(id);
        expect(row?.title).toBe(winner);

        const history = await historyOf(id);
        expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
        // History matches the committed document, and the snapshot is the full content.
        expect(history[0]!.data).toEqual({ title: winner, body: 'shared body', tag: 'keep' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'two concurrent manual createVersion calls both succeed with distinct numbers (bounded retry)',
      async () => {
        const { gate, harness, collection, first, historyOf } = await prepare(2);
        const doc = await first.create({ collection, data: { title: 'v1' } });
        const documentId = doc.id as string;
        const [a, b] = harness.contenders;

        gate.arm(2);
        let created: VersionHistoryVersion[];
        try {
          created = await Promise.all([
            a!.createVersion({ collection, documentId, data: { title: 'v1' }, label: 'A' }),
            b!.createVersion({ collection, documentId, data: { title: 'v1' }, label: 'B' })
          ]);
        } finally {
          gate.disarm();
        }

        expect(created.map((v) => v.versionNumber).sort()).toEqual([2, 3]);
        expect((await historyOf(documentId)).map((v) => v.versionNumber)).toEqual([3, 2, 1]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'restoring a version identical to the current content still writes exactly one labeled snapshot',
      async () => {
        const { first, collection, rowOf, historyOf } = await prepare();
        const doc = await first.create({ collection, data: { title: 'same', body: 'b' } });
        const id = doc.id as string;
        const [v1] = await first.listVersions({ collection, documentId: id });

        await first.restoreVersion({ collection, versionId: v1!.id });

        expect((await rowOf(id))?.title).toBe('same');
        const history = await historyOf(id);
        // An unlabeled version's `label` is absent on InMemory and `null` on the SQL adapters (pre-062).
        expect(history.map((v) => [v.versionNumber, v.label ?? undefined])).toEqual([
          [2, 'Restored from version 1'],
          [1, undefined]
        ]);
        expect(history[0]!.data).toEqual(history[1]!.data);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a partial update snapshots the full content; restoring it reproduces that content exactly, once',
      async () => {
        const { first, collection, rowOf, historyOf } = await prepare();
        const doc = await first.create({
          collection,
          data: { title: 'Hello', body: 'Original body', tag: 't1' }
        });
        const id = doc.id as string;
        const created = await rowOf(id);

        await first.update({ collection, id, data: { title: 'Updated' } });
        await first.update({ collection, id, data: { body: null, tag: 't2' } });

        const history = await historyOf(id);
        expect(history.map((v) => v.data)).toEqual([
          { title: 'Updated', body: null, tag: 't2' },
          { title: 'Updated', body: 'Original body', tag: 't1' },
          { title: 'Hello', body: 'Original body', tag: 't1' }
        ]);

        const [, v2] = await first.listVersions({ collection, documentId: id });
        await first.restoreVersion({ collection, versionId: v2!.id });

        const restored = await rowOf(id);
        expect({ title: restored?.title, body: restored?.body, tag: restored?.tag }).toEqual({
          title: 'Updated',
          body: 'Original body',
          tag: 't1'
        });
        // Stable identity and creation metadata are never rewritten by a restore.
        expect(restored?.id).toBe(id);
        expect(restored?.created_at).toEqual(created?.created_at);

        const after = await historyOf(id);
        expect(after).toHaveLength(4);
        expect(after[0]).toEqual({
          versionNumber: 4,
          data: { title: 'Updated', body: 'Original body', tag: 't1' },
          label: 'Restored from version 2'
        });
      },
      TEST_TIMEOUT_MS
    );
  });
}
