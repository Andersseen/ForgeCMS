import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';

// Write-time access contract (spec 068). Duck-typed on purpose — like every other contract in this package
// it must not import `@forge-cms/runtime`/`@forge-cms/db`.

type Row = Record<string, unknown>;
type User = { id: string; role?: string };

/** The subset of `ForgeCmsRuntime`'s Local API under test. */
export interface WriteAccessRuntime {
  create(args: { collection: string; data: Row }): Promise<Row>;
  update(args: {
    collection: string;
    id: string;
    data: Row;
    user?: User;
    overrideAccess?: boolean;
  }): Promise<Row>;
  delete(args: {
    collection: string;
    id: string;
    user?: User;
    overrideAccess?: boolean;
  }): Promise<Row>;
  updateGlobalDocument(args: {
    global: string;
    data: Row;
    user?: User;
    overrideAccess?: boolean;
  }): Promise<Row>;
}

export interface WriteAccessHarness {
  /** Two runtimes over their **own adapter instances** of one store; contender 0's database wrapped with `hold.wrap(database)`. */
  contenders: WriteAccessRuntime[];
  database: {
    findById(collection: string, id: string): Promise<Row | null>;
  };
}

/** Every contender's runtime must register (and `syncSchema()`) {@link writeAccessSchema}`(prefix)`. */
export type WriteAccessHarnessFactory = (options: {
  prefix: string;
  hold: WriteHold;
}) => Promise<WriteAccessHarness>;

/**
 * `<p>_docs`: update and delete are granted only on rows with `region: 'eu'`; `<p>_vdocs` is the same,
 * versioned; `<p>_children.parent` → docs cascades, so deleting a parent with a child is a relation
 * batch; global `<p>_site` is granted update only while `region: 'eu'`.
 */
export function writeAccessSchema(prefix: string): {
  collections: CollectionDefinition[];
  globals: GlobalDefinition[];
} {
  const scoped = () => ({ region: 'eu' });
  return {
    collections: [
      defineCollection({
        slug: `${prefix}_docs`,
        access: { read: () => true, create: () => true, update: scoped, delete: scoped },
        fields: { title: defineField.text(), region: defineField.text() }
      }),
      defineCollection({
        slug: `${prefix}_vdocs`,
        versions: true,
        access: { read: () => true, create: () => true, update: scoped, delete: scoped },
        fields: { title: defineField.text(), region: defineField.text() }
      }),
      defineCollection({
        slug: `${prefix}_children`,
        fields: {
          parent: defineField.relation({ collection: `${prefix}_docs`, onDelete: 'cascade' })
        }
      })
    ],
    globals: [
      defineGlobal({
        slug: `${prefix}_site`,
        access: { read: () => true, update: scoped },
        fields: { title: defineField.text(), region: defineField.text() }
      })
    ]
  };
}

const WRITE_METHODS = new Set([
  'create',
  'update',
  'updateIf',
  'delete',
  'deleteIf',
  'atomicWrite'
]);

/**
 * Holds the wrapped database's next write — whatever primitive the operation uses — until released, after
 * the operation made every read and decision. That is how the suite lands an independent writer's commit
 * exactly between an access check and the write it guards.
 */
export interface WriteHold {
  wrap<T extends object>(database: T): T;
  holdNext(): { reached: Promise<void>; release(): void };
}

export function createWriteHold(): WriteHold {
  let armed: { arrive: () => void; gate: Promise<void> } | undefined;
  return {
    wrap<T extends object>(database: T): T {
      return new Proxy(database, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          if (typeof property === 'string' && WRITE_METHODS.has(property)) {
            return async (...args: unknown[]) => {
              const hold = armed;
              if (hold) {
                armed = undefined;
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
    holdNext() {
      let arrive: () => void = () => {};
      let release: () => void = () => {};
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      armed = { arrive, gate };
      return { reached, release };
    }
  };
}

const TEST_TIMEOUT_MS = 30_000;
let prefixCounter = 0;
const bob: User = { id: 'bob', role: 'editor' };

function codeOf(outcome: PromiseSettledResult<unknown>): unknown {
  if (outcome.status === 'fulfilled') return 'ok';
  const reason: unknown = outcome.reason;
  return typeof reason === 'object' && reason !== null
    ? (reason as { code?: unknown }).code
    : reason;
}

/**
 * Proves, on one backend, that a query-returning update/delete rule is enforced **at the write**
 * (spec 068): the caller's write is held after its access check passed; an independent trusted writer
 * then moves the row out of the caller's scope; released, the caller's write must not apply.
 */
export function runWriteAccessContractTests(setup: WriteAccessHarnessFactory) {
  describe('write-time access queries under independent writers (spec 068)', () => {
    async function prepare() {
      const prefix = `wa${++prefixCounter}_${Date.now().toString(36)}`;
      const hold = createWriteHold();
      const harness = await setup({ prefix, hold });
      const [caller, mover] = harness.contenders;
      if (!caller || !mover) throw new Error('setup() must return exactly 2 contenders');
      return { hold, caller, mover, prefix, database: harness.database };
    }

    it(
      'an update whose row left the caller’s scope before the write: 409, nothing written',
      async () => {
        const { hold, caller, mover, prefix, database } = await prepare();
        const docs = `${prefix}_docs`;
        const doc = await mover.create({ collection: docs, data: { title: 'orig', region: 'eu' } });
        const id = doc.id as string;

        const held = hold.holdNext();
        const edit = caller.update({
          collection: docs,
          id,
          user: bob,
          overrideAccess: false,
          data: { title: 'bob edit' }
        });
        await held.reached;
        await mover.update({ collection: docs, id, data: { region: 'us' } });
        held.release();
        const [outcome] = await Promise.allSettled([edit]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await database.findById(docs, id)).toMatchObject({ title: 'orig', region: 'us' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a delete whose row left the caller’s scope before the write: 409, the row survives',
      async () => {
        const { hold, caller, mover, prefix, database } = await prepare();
        const docs = `${prefix}_docs`;
        const doc = await mover.create({ collection: docs, data: { title: 'keep', region: 'eu' } });
        const id = doc.id as string;

        const held = hold.holdNext();
        const deletion = caller.delete({ collection: docs, id, user: bob, overrideAccess: false });
        await held.reached;
        await mover.update({ collection: docs, id, data: { region: 'us' } });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await database.findById(docs, id)).toMatchObject({ title: 'keep', region: 'us' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a global update whose row left the caller’s scope before the write: 409, nothing written',
      async () => {
        const { hold, caller, mover, prefix, database } = await prepare();
        const site = `${prefix}_site`;
        await mover.updateGlobalDocument({ global: site, data: { title: 'orig', region: 'eu' } });

        const held = hold.holdNext();
        const edit = caller.updateGlobalDocument({
          global: site,
          user: bob,
          overrideAccess: false,
          data: { title: 'bob edit' }
        });
        await held.reached;
        await mover.updateGlobalDocument({ global: site, data: { region: 'us' } });
        held.release();
        const [outcome] = await Promise.allSettled([edit]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await database.findById(`_global_${site}`, 'global')).toMatchObject({
          title: 'orig',
          region: 'us'
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a versioned update whose row left the caller’s scope: 409, no document change, no new version',
      async () => {
        const { hold, caller, mover, prefix, database } = await prepare();
        const vdocs = `${prefix}_vdocs`;
        const doc = await mover.create({
          collection: vdocs,
          data: { title: 'orig', region: 'eu' }
        });
        const id = doc.id as string;

        const held = hold.holdNext();
        const edit = caller.update({
          collection: vdocs,
          id,
          user: bob,
          overrideAccess: false,
          data: { title: 'bob edit' }
        });
        await held.reached;
        await mover.update({ collection: vdocs, id, data: { region: 'us' } });
        held.release();
        const [outcome] = await Promise.allSettled([edit]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await database.findById(vdocs, id)).toMatchObject({ title: 'orig', region: 'us' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a cascading delete whose root left the caller’s scope: 409, root and dependent survive',
      async () => {
        const { hold, caller, mover, prefix, database } = await prepare();
        const docs = `${prefix}_docs`;
        const children = `${prefix}_children`;
        const doc = await mover.create({ collection: docs, data: { title: 'keep', region: 'eu' } });
        const id = doc.id as string;
        const child = await mover.create({ collection: children, data: { parent: id } });

        const held = hold.holdNext();
        const deletion = caller.delete({ collection: docs, id, user: bob, overrideAccess: false });
        await held.reached;
        await mover.update({ collection: docs, id, data: { region: 'us' } });
        held.release();
        const [outcome] = await Promise.allSettled([deletion]);

        expect(codeOf(outcome!)).toBe('CONCURRENT_MODIFICATION');
        expect(await database.findById(docs, id)).not.toBeNull();
        expect(await database.findById(children, child.id as string)).not.toBeNull();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'within scope, the caller’s update and delete still apply',
      async () => {
        const { caller, mover, prefix, database } = await prepare();
        const docs = `${prefix}_docs`;
        const doc = await mover.create({ collection: docs, data: { title: 'orig', region: 'eu' } });
        const id = doc.id as string;
        await caller.update({
          collection: docs,
          id,
          user: bob,
          overrideAccess: false,
          data: { title: 'bob edit' }
        });
        expect((await database.findById(docs, id))?.title).toBe('bob edit');
        await caller.delete({ collection: docs, id, user: bob, overrideAccess: false });
        expect(await database.findById(docs, id)).toBeNull();
      },
      TEST_TIMEOUT_MS
    );
  });
}
