import { describe, expect, it } from 'vitest';
import { createWriteGate, type WriteGate } from './last-admin.js';

// First-admin provisioning proof (spec 060). Duck-typed on purpose — like every other contract in this
// package it must not import `@forge-cms/db`/`@forge-cms/auth`.

const BOOTSTRAP = '_forge_bootstrap';
const TEST_TIMEOUT_MS = 30_000;

type Role = 'admin' | 'editor' | 'viewer';
type Outcome = { ok: true; user: { id: string; role?: string } } | { ok: false; reason?: string };

/** The subset of `UsersCollectionAuthAdapter` under test. */
export interface FirstAdminUsers {
  signup(input: { email: string; password: string }): Promise<Outcome>;
  createUser(input: { email: string; password: string; role?: Role }): Promise<Outcome>;
  updateUser(id: string, input: { role?: Role }): Promise<unknown>;
  /** Registers the bootstrap collection on this contender's database. */
  syncSchema(): Promise<void>;
}

/** The subset of a `DatabaseAdapter` the harness inspects and seeds. */
export interface FirstAdminDatabase {
  count(collection: string, where?: Record<string, unknown>): Promise<number>;
  findById(collection: string, id: string): Promise<Record<string, unknown> | null>;
  create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface FirstAdminContender {
  /** Its own `UsersCollectionAuthAdapter`, writing through `wrap(database)`. */
  users: FirstAdminUsers;
  /** The same database WITHOUT the barrier or fault injection, for inspecting and seeding the store. */
  database: FirstAdminDatabase;
}

export type FirstAdminHarnessFactory = (options: {
  /** A users-collection slug no other test has used, so a persistent shared store needs no cleanup. */
  collection: string;
  /** How many independent contenders to build (each over its own adapter instance and, where the backend allows, its own connection). */
  parties: number;
  /** Wrap the database each contender's auth adapter writes through: applies the barrier and the fault injection. */
  wrap: <T extends object>(database: T) => T;
}) => Promise<{ contenders: FirstAdminContender[] }>;

type FaultKind = 'duplicate-email' | 'missing-row';

/**
 * Makes user creation fail *wherever it happens*, after everything that precedes it has succeeded — a
 * wrapper that merely refused the whole call would prove nothing about rollback:
 * - a plain `create()` on the users collection throws (the pre-spec-060 shape: claim, then create);
 * - an `atomicWrite()` that creates a user gets one more operation appended, so it fails AFTER the claim
 *   and the user were written: `'duplicate-email'` a second user with the same email (unique violation),
 *   `'missing-row'` an `update` of a row that does not exist (a non-unique failure).
 */
function createFaultInjector() {
  let armed: FaultKind | undefined;
  return {
    arm(kind: FaultKind) {
      armed = kind;
    },
    disarm() {
      armed = undefined;
    },
    wrap<T extends object>(database: T, usersSlug: string): T {
      return new Proxy(database, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;

          if (armed && property === 'create') {
            return async (collection: string, ...rest: unknown[]) => {
              if (collection === usersSlug) throw new Error('injected: user create failed');
              return method.call(target, collection, ...rest);
            };
          }
          if (armed && property === 'atomicWrite') {
            return async (
              operations: { type: string; collection: string; data?: Record<string, unknown> }[]
            ) => {
              const userCreate = operations.find(
                (o) => o.type === 'create' && o.collection === usersSlug
              );
              if (!userCreate) return method.call(target, operations);
              const failing =
                armed === 'duplicate-email'
                  ? { ...userCreate, data: { ...userCreate.data, id: 'injected-duplicate' } }
                  : {
                      type: 'update',
                      collection: usersSlug,
                      id: 'injected-missing-row',
                      data: { name: 'nobody' }
                    };
              return method.call(target, [...operations, failing]);
            };
          }
          return method.bind(target);
        }
      });
    }
  };
}

let collectionCounter = 0;

/**
 * Proves first-admin provisioning is all-or-nothing and single-winner (spec 060):
 *
 * - N independent `UsersCollectionAuthAdapter`s racing to be the first user, held at a {@link WriteGate}
 *   so every party has finished reading and hashing before any write lands, yield exactly one admin;
 * - a first-user creation that fails AFTER the bootstrap claim succeeded leaves neither user nor claim,
 *   and the next valid first user still becomes the administrator (spec 059 reproduced the opposite: a
 *   consumed claim with no admin behind it);
 * - a claim burned before spec 060 (claim present, no admin) is never auto-repaired by a public signup,
 *   and the documented trusted recovery works.
 */
export function runFirstAdminBootstrapContractTests(setup: FirstAdminHarnessFactory) {
  describe('first-admin provisioning (spec 060)', () => {
    async function prepare(parties: number) {
      const collection = `first_admin_${++collectionCounter}`;
      const gate: WriteGate = createWriteGate();
      const fault = createFaultInjector();
      const { contenders } = await setup({
        collection,
        parties,
        wrap: (database) => gate.wrap(fault.wrap(database, collection))
      });
      if (contenders.length !== parties) {
        throw new Error(`setup() must return exactly ${parties} contenders`);
      }
      await Promise.all(contenders.map((c) => c.users.syncSchema()));

      const inspector = contenders[0]!.database;
      return {
        collection,
        gate,
        fault,
        contenders,
        userCount: () => inspector.count(collection),
        adminCount: () => inspector.count(collection, { role: 'admin' }),
        claimCount: () => inspector.count(BOOTSTRAP, { slot: collection }),
        roleOf: async (id: string) => (await inspector.findById(collection, id))?.role
      };
    }

    const credentials = (index: number) => ({
      email: `user${index}@example.com`,
      password: 'password123'
    });
    const okRole = (outcome: Outcome) => {
      if (!outcome.ok) throw new Error(`expected success, got ${outcome.reason}`);
      return outcome.user.role;
    };

    describe('concurrent first signups', () => {
      for (const parties of [2, 3]) {
        it(
          `${parties} independent callers racing to be first: exactly one becomes admin`,
          async () => {
            const { gate, contenders, userCount, adminCount, claimCount } = await prepare(parties);

            gate.arm(parties);
            let outcomes: Outcome[];
            try {
              outcomes = await Promise.all(
                contenders.map((c, i) => c.users.signup(credentials(i)))
              );
              // Every party reached its first write before any write landed.
              expect(gate.arrivals).toBe(parties);
            } finally {
              gate.disarm();
            }

            const roles = outcomes.map(okRole);
            expect(roles.filter((r) => r === 'admin')).toHaveLength(1);
            expect(roles.filter((r) => r === 'viewer')).toHaveLength(parties - 1);
            expect(await userCount()).toBe(parties);
            expect(await adminCount()).toBe(1);
            expect(await claimCount()).toBe(1);
          },
          TEST_TIMEOUT_MS
        );
      }

      it(
        'the same email racing to be first: one succeeds as admin, the rest are email-in-use, one claim',
        async () => {
          const { gate, contenders, userCount, adminCount, claimCount } = await prepare(3);

          gate.arm(3);
          let outcomes: Outcome[];
          try {
            outcomes = await Promise.all(contenders.map((c) => c.users.signup(credentials(0))));
            expect(gate.arrivals).toBe(3);
          } finally {
            gate.disarm();
          }

          expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
          expect(outcomes.filter((o) => !o.ok)).toEqual([
            { ok: false, reason: 'email-in-use' },
            { ok: false, reason: 'email-in-use' }
          ]);
          expect(await userCount()).toBe(1);
          expect(await adminCount()).toBe(1);
          expect(await claimCount()).toBe(1);
        },
        TEST_TIMEOUT_MS
      );

      it(
        'after a first user exists, nobody can become admin through signup',
        async () => {
          const { contenders, adminCount } = await prepare(2);

          expect(okRole(await contenders[0]!.users.signup(credentials(0)))).toBe('admin');
          expect(okRole(await contenders[1]!.users.signup(credentials(1)))).toBe('viewer');
          expect(okRole(await contenders[1]!.users.signup(credentials(2)))).toBe('viewer');
          expect(await adminCount()).toBe(1);
        },
        TEST_TIMEOUT_MS
      );
    });

    describe('a failed first-user creation never burns the bootstrap opportunity', () => {
      const flows = ['signup', 'createUser'] as const;
      const faults: FaultKind[] = ['duplicate-email', 'missing-row'];

      for (const flow of flows) {
        for (const kind of faults) {
          it(
            `${flow} / ${kind}: the claim rolls back with the user, and the retry becomes admin`,
            async () => {
              const { fault, contenders, userCount, claimCount, roleOf } = await prepare(2);
              const [first, second] = contenders as [FirstAdminContender, FirstAdminContender];

              fault.arm(kind);
              const failed = await first.users[flow](credentials(0)).then(
                (result) => result,
                (error: unknown) => error
              );
              fault.disarm();
              expect(failed).not.toMatchObject({ ok: true });

              // Nothing at all was committed: no user, and — the bug — no claim either.
              expect(await userCount()).toBe(0);
              expect(await claimCount()).toBe(0);

              // The opportunity is intact: the next valid first user still becomes the administrator...
              const retry = await first.users[flow](credentials(0));
              if (!retry.ok) throw new Error(`expected the retry to succeed, got ${retry.reason}`);
              expect(retry.user.role).toBe('admin');
              expect(await roleOf(retry.user.id)).toBe('admin');
              expect(await userCount()).toBe(1);
              expect(await claimCount()).toBe(1);

              // ...and only that one: the claim is now genuinely consumed.
              expect(okRole(await second.users.signup(credentials(1)))).toBe('viewer');
            },
            TEST_TIMEOUT_MS
          );
        }
      }

      it(
        'after a failed attempt, a concurrent pair still yields exactly one admin',
        async () => {
          const { fault, gate, contenders, userCount, adminCount, claimCount } = await prepare(2);

          fault.arm('missing-row');
          await contenders[0]!.users.signup(credentials(0)).catch(() => undefined);
          fault.disarm();
          expect(await claimCount()).toBe(0);

          gate.arm(2);
          try {
            const outcomes = await Promise.all(
              contenders.map((c, i) => c.users.signup(credentials(i)))
            );
            expect(outcomes.every((o) => o.ok)).toBe(true);
          } finally {
            gate.disarm();
          }
          expect(await adminCount()).toBe(1);
          expect(await userCount()).toBe(2);
          expect(await claimCount()).toBe(1);
        },
        TEST_TIMEOUT_MS
      );
    });

    describe('a bootstrap claim burned before spec 060 (claim present, no admin)', () => {
      /** The pre-060 corruption: the claim committed, the user never did. */
      const burn = (
        database: FirstAdminDatabase,
        collection: string
      ): Promise<Record<string, unknown>> => database.create(BOOTSTRAP, { slot: collection });

      it(
        'public signup is never promoted to admin — it stays viewer, and the claim is untouched',
        async () => {
          const { collection, contenders, adminCount, claimCount } = await prepare(1);
          await burn(contenders[0]!.database, collection);

          expect(okRole(await contenders[0]!.users.signup(credentials(0)))).toBe('viewer');
          expect(okRole(await contenders[0]!.users.signup(credentials(1)))).toBe('viewer');

          expect(await adminCount()).toBe(0);
          expect(await claimCount()).toBe(1);
        },
        TEST_TIMEOUT_MS
      );

      it(
        'recovery A: trusted createUser({ role: "admin" }) provisions an admin with zero users, leaving the claim as it was',
        async () => {
          const { collection, contenders, userCount, adminCount, claimCount } = await prepare(1);
          await burn(contenders[0]!.database, collection);
          expect(await userCount()).toBe(0);

          const created = await contenders[0]!.users.createUser({
            ...credentials(0),
            role: 'admin'
          });
          expect(okRole(created)).toBe('admin');

          expect(await adminCount()).toBe(1);
          expect(await claimCount()).toBe(1);
          // Ordinary rules apply from here on: signup is a viewer.
          expect(okRole(await contenders[0]!.users.signup(credentials(1)))).toBe('viewer');
        },
        TEST_TIMEOUT_MS
      );

      it(
        'recovery B: trusted updateUser promotes a viewer that already signed up',
        async () => {
          const { collection, contenders, adminCount, claimCount, roleOf } = await prepare(1);
          await burn(contenders[0]!.database, collection);

          const signedUp = await contenders[0]!.users.signup(credentials(0));
          if (!signedUp.ok) throw new Error('expected success');
          expect(signedUp.user.role).toBe('viewer');

          await contenders[0]!.users.updateUser(signedUp.user.id, { role: 'admin' });

          expect(await roleOf(signedUp.user.id)).toBe('admin');
          expect(await adminCount()).toBe(1);
          expect(await claimCount()).toBe(1);
        },
        TEST_TIMEOUT_MS
      );
    });
  });
}
