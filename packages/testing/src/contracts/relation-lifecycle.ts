import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { codeOf, requirePair } from './harness.js';

// Relation lifecycle consistency contract (spec 064). Duck-typed on purpose — like every other contract in
// this package it must not import `@forge-cms/runtime`/`@forge-cms/db`.

type Row = Record<string, unknown>;

/** The subset of `ForgeCmsRuntime`'s Local API under test (trusted calls; `overrideAccess` defaults to true). */
export interface RelationLifecycleRuntime {
  create(args: { collection: string; data: Row }): Promise<Row>;
  update(args: { collection: string; id: string; data: Row }): Promise<Row>;
  delete(args: { collection: string; id: string }): Promise<Row>;
}

/** Raw, **unheld** database access to the same store, for reading what really committed. */
export interface RelationLifecycleDatabase {
  findById(collection: string, id: string): Promise<Row | null>;
  findMany(options: { collection: string; where?: Row }): Promise<Row[]>;
}

export interface RelationLifecycleHarness {
  /** `parties` runtimes, each over its **own adapter instance** (own client/connection) of one store, each database wrapped with `gate.wrap(database, index)`. */
  contenders: RelationLifecycleRuntime[];
  database: RelationLifecycleDatabase;
}

/**
 * Builds the harness. Every contender's runtime must register (and `syncSchema()`) exactly
 * {@link relationLifecycleCollections}`(prefix)`.
 */
export type RelationLifecycleHarnessFactory = (options: {
  /** A prefix no other test has used, so a persistent shared store needs no cleanup. */
  prefix: string;
  parties: number;
  gate: BatchHold;
}) => Promise<RelationLifecycleHarness>;

/**
 * The collections the suite runs against, for a given prefix:
 *
 * - `<p>_authors` — the delete target;
 * - `<p>_posts.author` → authors, `restrict` (the default);
 * - `<p>_notes.author` → authors, `set-null`, and `<p>_notes.watchers` → authors, `many`, `set-null`;
 * - `<p>_threads.author` → authors, `cascade`.
 */
export function relationLifecycleCollections(prefix: string): CollectionDefinition[] {
  const authors = `${prefix}_authors`;
  return [
    defineCollection({ slug: authors, fields: { name: defineField.text({ required: true }) } }),
    defineCollection({
      slug: `${prefix}_posts`,
      fields: {
        title: defineField.text({ required: true }),
        author: defineField.relation({ collection: authors })
      }
    }),
    defineCollection({
      slug: `${prefix}_notes`,
      fields: {
        body: defineField.text(),
        author: defineField.relation({ collection: authors, onDelete: 'set-null' }),
        watchers: defineField.relation({ collection: authors, many: true, onDelete: 'set-null' })
      }
    }),
    defineCollection({
      slug: `${prefix}_threads`,
      fields: {
        title: defineField.text({ required: true }),
        author: defineField.relation({ collection: authors, onDelete: 'cascade' })
      }
    })
  ];
}

/**
 * Holds one contender's next `atomicWrite()` — i.e. after its operation did every read, ran every
 * before-hook and built its batch, and before the batch reaches the database — until released. That is
 * how the suite places a second, independent writer's commit exactly inside the first one's window,
 * without relying on scheduling luck.
 */
export interface BatchHold {
  wrap<T extends object>(database: T, contender: number): T;
  /** Arms a hold on `contender`'s next batch. `reached` resolves once that batch is waiting. */
  holdNext(contender: number): { reached: Promise<void>; release(): void };
}

export function createBatchHold(): BatchHold {
  const armed = new Map<number, { arrive: () => void; gate: Promise<void> }>();
  return {
    wrap<T extends object>(database: T, contender: number): T {
      return new Proxy(database, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          if (property === 'atomicWrite') {
            return async (...args: unknown[]) => {
              const hold = armed.get(contender);
              if (hold) {
                armed.delete(contender);
                hold.arrive();
                await hold.gate;
              }
              return method.apply(target, args);
            };
          }
          return method.bind(target);
        }
      });
    },
    holdNext(contender) {
      let arrive: () => void = () => {};
      let release: () => void = () => {};
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      armed.set(contender, { arrive, gate });
      return { reached, release };
    }
  };
}

const TEST_TIMEOUT_MS = 30_000;
let prefixCounter = 0;

/** Lets the wall clock move on, so a later write's `updated_at` differs from the one a planner read. */
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 2));

/**
 * Proves, on one backend, that relation lifecycle holds against an **independent** writer (spec 064):
 * a reference created or moved while a delete is being prepared, a target deleted while a reference
 * write is being prepared, and a set-null / cascade dependent edited meanwhile. Each scenario forces one
 * exact interleaving with {@link createBatchHold}, then reads the committed state back from the database —
 * the invariant is never inferred from the thrown error alone. Acceptable outcomes: the delete fails, or
 * the reference write fails. Never both commit.
 */
export function runRelationLifecycleContractTests(setup: RelationLifecycleHarnessFactory) {
  describe('relation lifecycle under independent writers (spec 064)', () => {
    async function prepare() {
      const prefix = `rl${++prefixCounter}_${Date.now().toString(36)}`;
      const gate = createBatchHold();
      const harness = await setup({ prefix, parties: 2, gate });
      const [deleter, writer] = requirePair(harness.contenders);
      const c = {
        authors: `${prefix}_authors`,
        posts: `${prefix}_posts`,
        notes: `${prefix}_notes`,
        threads: `${prefix}_threads`
      };
      const author = async (name = 'A') =>
        (await writer.create({ collection: c.authors, data: { name } })).id as string;
      const row = (collection: string, id: string) => harness.database.findById(collection, id);
      /** Every surviving row of `collection` whose `field` references a missing author. */
      const dangling = async (collection: string, field: string) => {
        const rows = await harness.database.findMany({ collection });
        const result: Row[] = [];
        for (const r of rows) {
          const value = r[field];
          const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
          for (const id of ids) {
            if (!(await row(c.authors, id as string))) result.push(r);
          }
        }
        return result;
      };
      return { gate, deleter, writer, c, author, row, dangling, database: harness.database };
    }

    it(
      'a reference created while a delete is prepared: the reference commits, the delete fails',
      async () => {
        const { gate, deleter, writer, c, author, row, dangling } = await prepare();
        const a = await author();

        const held = gate.holdNext(0);
        const deletion = deleter.delete({ collection: c.authors, id: a });
        await held.reached;
        const created = await writer.create({
          collection: c.posts,
          data: { title: 'Q', author: a }
        });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).not.toBeNull();
        expect((await row(c.posts, created.id as string))?.author).toBe(a);
        expect(await dangling(c.posts, 'author')).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a target deleted while a reference write is prepared: the delete commits, the write fails',
      async () => {
        const { gate, deleter, writer, c, author, row, dangling, database } = await prepare();
        const a = await author();

        const held = gate.holdNext(1);
        const creation = writer.create({ collection: c.posts, data: { title: 'Q', author: a } });
        await held.reached;
        await deleter.delete({ collection: c.authors, id: a });
        held.release();
        const [outcome] = await Promise.allSettled([creation]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).toBeNull();
        expect(await database.findMany({ collection: c.posts })).toEqual([]);
        expect(await dangling(c.posts, 'author')).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'an existing document moved onto the target while its delete is prepared: the delete fails',
      async () => {
        const { gate, deleter, writer, c, author, row, dangling } = await prepare();
        const a = await author('A');
        const b = await author('B');
        const post = await writer.create({ collection: c.posts, data: { title: 'P', author: b } });

        const held = gate.holdNext(0);
        const deletion = deleter.delete({ collection: c.authors, id: a });
        await held.reached;
        await writer.update({ collection: c.posts, id: post.id as string, data: { author: a } });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).not.toBeNull();
        expect(await dangling(c.posts, 'author')).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a set-null dependent edited while the delete is prepared: fresh content is never overwritten',
      async () => {
        const { gate, deleter, writer, c, author, row } = await prepare();
        const a = await author('A');
        const b = await author('B');
        const note = await writer.create({
          collection: c.notes,
          data: { body: 'v1', author: a, watchers: [a] }
        });
        const id = note.id as string;
        await nextMillisecond();

        const held = gate.holdNext(0);
        const deletion = deleter.delete({ collection: c.authors, id: a });
        await held.reached;
        await writer.update({ collection: c.notes, id, data: { body: 'v2', watchers: [a, b] } });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        // The planned patch (`watchers: []`) was computed from the old row; committing it would drop B.
        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).not.toBeNull();
        expect(await row(c.notes, id)).toMatchObject({ body: 'v2', author: a, watchers: [a, b] });

        // Retried against the fresh state, the delete clears only the deleted author.
        await deleter.delete({ collection: c.authors, id: a });
        expect(await row(c.authors, a)).toBeNull();
        expect(await row(c.notes, id)).toMatchObject({ body: 'v2', author: null, watchers: [b] });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'an update re-sending a reference that a delete cleared meanwhile: the update fails, nothing dangles',
      async () => {
        const { gate, deleter, writer, c, author, row, dangling } = await prepare();
        const a = await author('A');
        const b = await author('B');
        const note = await writer.create({
          collection: c.notes,
          data: { body: 'v1', author: a, watchers: [a, b] }
        });
        const id = note.id as string;

        // A whole-document save (as an admin form sends it) that read the note before the delete.
        const held = gate.holdNext(1);
        const save = writer.update({
          collection: c.notes,
          id,
          data: { body: 'v2', author: a, watchers: [a, b] }
        });
        await held.reached;
        await deleter.delete({ collection: c.authors, id: a });
        held.release();
        const [outcome] = await Promise.allSettled([save]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).toBeNull();
        expect(await row(c.notes, id)).toMatchObject({ body: 'v1', author: null, watchers: [b] });
        expect(await dangling(c.notes, 'author')).toEqual([]);
        expect(await dangling(c.notes, 'watchers')).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a cascade dependent created while the delete is prepared: nothing is deleted, then the retry takes both',
      async () => {
        const { gate, deleter, writer, c, author, row, dangling, database } = await prepare();
        const a = await author();
        const t1 = await writer.create({ collection: c.threads, data: { title: 'T1', author: a } });

        const held = gate.holdNext(0);
        const deletion = deleter.delete({ collection: c.authors, id: a });
        await held.reached;
        const t2 = await writer.create({ collection: c.threads, data: { title: 'T2', author: a } });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await row(c.authors, a)).not.toBeNull();
        expect(await row(c.threads, t1.id as string)).not.toBeNull();
        expect(await row(c.threads, t2.id as string)).not.toBeNull();

        await deleter.delete({ collection: c.authors, id: a });
        expect(await database.findMany({ collection: c.threads })).toEqual([]);
        expect(await dangling(c.threads, 'author')).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a cascade dependent re-pointed elsewhere while the delete is prepared: it is not deleted',
      async () => {
        const { gate, deleter, writer, c, author, row } = await prepare();
        const a = await author('A');
        const b = await author('B');
        const thread = await writer.create({
          collection: c.threads,
          data: { title: 'T', author: a }
        });
        await nextMillisecond();

        const held = gate.holdNext(0);
        const deletion = deleter.delete({ collection: c.authors, id: a });
        await held.reached;
        await writer.update({
          collection: c.threads,
          id: thread.id as string,
          data: { author: b }
        });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        // The planned cascade delete of the thread was guarded by the row it read; the thread now
        // belongs to B and must survive.
        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect((await row(c.threads, thread.id as string))?.author).toBe(b);
        expect(await row(c.authors, a)).not.toBeNull();
      },
      TEST_TIMEOUT_MS
    );
  });
}
