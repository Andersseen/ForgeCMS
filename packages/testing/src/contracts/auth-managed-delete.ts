import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import type { BatchHold } from './relation-lifecycle.js';
import { createBatchHold } from './relation-lifecycle.js';
import { requirePair } from './harness.js';

// Auth-managed delete relation integrity contract (spec 065). Duck-typed on purpose — like every other
// contract in this package it must not import `@forge-cms/runtime`/`@forge-cms/auth`/`@forge-cms/db`.

type Row = Record<string, unknown>;

/** The subset of `ForgeCmsRuntime`'s Local API under test (trusted calls). */
export interface AuthManagedDeleteRuntime {
  create(args: { collection: string; data: Row }): Promise<Row>;
  update(args: { collection: string; id: string; data: Row }): Promise<Row>;
  updateGlobalDocument(args: { global: string; data: Row }): Promise<Row>;
}

/** The subset of `UsersCollectionAuthAdapter` under test — the canonical user lifecycle. */
export interface AuthManagedDeleteUsers {
  createUser(input: {
    email: string;
    password: string;
    role?: 'admin' | 'editor' | 'viewer';
  }): Promise<{ ok: boolean; user?: { id: string } }>;
  deleteUser(id: string): Promise<void>;
}

export interface AuthManagedDeleteContender {
  runtime: AuthManagedDeleteRuntime;
  /** The auth adapter **passed to that runtime**, so the runtime has wired its delete guard into it. */
  users: AuthManagedDeleteUsers;
}

/** Raw, **unheld** database access to the same store, for reading what really committed. */
export interface AuthManagedDeleteDatabase {
  findById(collection: string, id: string): Promise<Row | null>;
  findMany(options: { collection: string; where?: Row }): Promise<Row[]>;
}

export interface AuthManagedDeleteHarness {
  /** `parties` contenders, each a runtime + auth adapter over its **own adapter instance** of one store, that database wrapped with `gate.wrap(database, index)` and shared by the runtime and its auth adapter. */
  contenders: AuthManagedDeleteContender[];
  database: AuthManagedDeleteDatabase;
}

/**
 * Builds the harness. Every contender's runtime must register (and `syncSchema()`)
 * {@link authManagedDeleteSchema}`(prefix)`'s collections and globals **plus** a users collection with
 * slug `schema.members` (e.g. `defineUsersCollection({ slug })`), managed by a
 * `UsersCollectionAuthAdapter({ collection: schema.members })` whose `userDatabase` is the runtime's own
 * (wrapped) database.
 */
export type AuthManagedDeleteHarnessFactory = (options: {
  /** A prefix no other test has used, so a persistent shared store needs no cleanup. */
  prefix: string;
  parties: number;
  gate: BatchHold;
}) => Promise<AuthManagedDeleteHarness>;

/**
 * The content schema the suite runs against. The managed collection is deliberately **not** called
 * `users` — protection must follow the auth adapter's configured slug.
 *
 * - `<p>_members` — the auth-managed users collection (built by the harness);
 * - `<p>_articles.author` → members, required (restrict); `<p>_articles.reviewers` → members, `many`;
 * - global `<p>_site.owner` → members.
 */
export function authManagedDeleteSchema(prefix: string): {
  members: string;
  articles: string;
  site: string;
  collections: CollectionDefinition[];
  globals: GlobalDefinition[];
} {
  const members = `${prefix}_members`;
  const articles = `${prefix}_articles`;
  const site = `${prefix}_site`;
  return {
    members,
    articles,
    site,
    collections: [
      defineCollection({
        slug: articles,
        fields: {
          title: defineField.text({ required: true }),
          author: defineField.relation({ collection: members, required: true }),
          reviewers: defineField.relation({ collection: members, many: true })
        }
      })
    ],
    globals: [
      defineGlobal({ slug: site, fields: { owner: defineField.relation({ collection: members }) } })
    ]
  };
}

const TEST_TIMEOUT_MS = 30_000;
let prefixCounter = 0;

function outcomeOf(outcome: PromiseSettledResult<unknown>): unknown {
  if (outcome.status === 'fulfilled') return 'ok';
  const reason: unknown = outcome.reason;
  if (typeof reason !== 'object' || reason === null) return reason;
  const { reason: why, code } = reason as { reason?: unknown; code?: unknown };
  return why ?? code;
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  const [outcome] = await Promise.allSettled([promise]);
  return outcomeOf(outcome!);
}

/**
 * Proves, on one backend, that deleting a user through the auth adapter's canonical `deleteUser()`
 * respects the content/global references to its managed collection (spec 065): a referenced user is
 * refused (restrict — never cascade or set-null), the relation guard and the last-admin guard commit in
 * the same batch as the delete, and a relation write and a user deletion racing each other in either
 * order never both commit. Every scenario reads the committed state back from the database.
 */
export function runAuthManagedDeleteContractTests(setup: AuthManagedDeleteHarnessFactory) {
  describe('auth-managed user deletion respects relations (spec 065)', () => {
    async function prepare() {
      const prefix = `amd${++prefixCounter}_${Date.now().toString(36)}`;
      const gate = createBatchHold();
      const harness = await setup({ prefix, parties: 2, gate });
      const [deleter, writer] = requirePair(harness.contenders);
      const schema = authManagedDeleteSchema(prefix);
      let emails = 0;
      const user = async (role: 'admin' | 'editor' | 'viewer') => {
        const result = await writer.users.createUser({
          email: `u${++emails}@${prefix}.test`,
          password: 'correct-horse-battery',
          role
        });
        if (!result.ok || !result.user) throw new Error('createUser failed');
        return result.user.id;
      };
      // The first user of a fresh collection is always provisioned as the admin.
      const admin = await user('admin');
      const row = (collection: string, id: string) => harness.database.findById(collection, id);
      const member = (id: string) => row(schema.members, id);
      const article = (data: Row) =>
        writer.runtime.create({ collection: schema.articles, data: { title: 'A', ...data } });
      /** Every surviving article whose `author`/`reviewers` names a member that no longer exists. */
      const dangling = async () => {
        const result: Row[] = [];
        for (const r of await harness.database.findMany({ collection: schema.articles })) {
          const ids = [r.author, ...(Array.isArray(r.reviewers) ? r.reviewers : [])];
          for (const id of ids) {
            if (typeof id === 'string' && !(await member(id))) result.push(r);
          }
        }
        return result;
      };
      return { gate, deleter, writer, schema, user, admin, row, member, article, dangling };
    }

    it(
      'an unreferenced user is deleted',
      async () => {
        const { deleter, user, member } = await prepare();
        const v = await user('viewer');
        await deleter.users.deleteUser(v);
        expect(await member(v)).toBeNull();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a user referenced by a single relation is refused and nothing changes',
      async () => {
        const { deleter, user, member, article, dangling } = await prepare();
        const v = await user('viewer');
        const a = await article({ author: v });

        expect(await settle(deleter.users.deleteUser(v))).toBe('referenced');
        expect(await member(v)).not.toBeNull();
        expect(a.author).toBe(v);
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a user referenced only through a many relation is refused',
      async () => {
        const { deleter, user, admin, member, article, dangling } = await prepare();
        const v = await user('viewer');
        const e = await user('editor');
        await article({ author: admin, reviewers: [e, v, admin] });

        expect(await settle(deleter.users.deleteUser(v))).toBe('referenced');
        expect(await member(v)).not.toBeNull();
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a user referenced by a global is refused until the global lets go',
      async () => {
        const { deleter, writer, schema, user, member } = await prepare();
        const v = await user('viewer');
        await writer.runtime.updateGlobalDocument({ global: schema.site, data: { owner: v } });

        expect(await settle(deleter.users.deleteUser(v))).toBe('referenced');
        expect(await member(v)).not.toBeNull();

        await writer.runtime.updateGlobalDocument({ global: schema.site, data: { owner: null } });
        await deleter.users.deleteUser(v);
        expect(await member(v)).toBeNull();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a referenced last admin is refused; a second admin does not lift the reference; releasing it does',
      async () => {
        const { deleter, writer, schema, user, admin, member, article, dangling } = await prepare();
        const a = await article({ author: admin });

        // Both invariants hold against this delete; the reference is reported first (spec 065 §6).
        expect(await settle(deleter.users.deleteUser(admin))).toBe('referenced');
        expect(await member(admin)).toMatchObject({ role: 'admin' });

        const second = await user('admin');
        expect(await settle(deleter.users.deleteUser(admin))).toBe('referenced');
        expect(await member(admin)).not.toBeNull();

        await writer.runtime.update({
          collection: schema.articles,
          id: a.id as string,
          data: { author: second }
        });
        await deleter.users.deleteUser(admin);
        expect(await member(admin)).toBeNull();
        expect(await member(second)).toMatchObject({ role: 'admin' });
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'deleting a user that does not exist stays a no-op',
      async () => {
        const { deleter, article, admin } = await prepare();
        // Even with references to *some* id present, a missing id has nothing to protect.
        await article({ author: admin });
        await expect(deleter.users.deleteUser('no-such-user')).resolves.toBeUndefined();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'writer first: a reference created while the user delete is prepared commits, the delete fails',
      async () => {
        const { gate, deleter, user, member, article, dangling } = await prepare();
        const v = await user('viewer');

        const held = gate.holdNext(0);
        const deletion = deleter.users.deleteUser(v);
        await held.reached;
        const a = await article({ author: v });
        held.release();

        expect(await settle(deletion)).toBe('referenced');
        expect(await member(v)).not.toBeNull();
        expect(a.author).toBe(v);
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'writer first: an existing document moved onto the user while its delete is prepared: the delete fails',
      async () => {
        const { gate, deleter, writer, schema, user, admin, member, article, dangling } =
          await prepare();
        const v = await user('viewer');
        const a = await article({ author: admin });

        const held = gate.holdNext(0);
        const deletion = deleter.users.deleteUser(v);
        await held.reached;
        await writer.runtime.update({
          collection: schema.articles,
          id: a.id as string,
          data: { reviewers: [v] }
        });
        held.release();

        expect(await settle(deletion)).toBe('referenced');
        expect(await member(v)).not.toBeNull();
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'delete first: a user deleted while a reference write is prepared commits, the write fails',
      async () => {
        const { gate, deleter, writer, schema, user, member, dangling } = await prepare();
        const v = await user('viewer');

        const held = gate.holdNext(1);
        const creation = writer.runtime.create({
          collection: schema.articles,
          data: { title: 'Q', author: v }
        });
        await held.reached;
        await deleter.users.deleteUser(v);
        held.release();

        expect(await settle(creation)).toBe('CONCURRENT_MODIFICATION');
        expect(await member(v)).toBeNull();
        expect(await dangling()).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );
  });
}
