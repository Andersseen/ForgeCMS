import { describe, expect, it } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { defineUsersCollection } from './user-fields.js';
import { UsersCollectionAuthAdapter } from './users-collection.adapter.js';

// Spec 060 — first-admin provisioning must never leave a partially-committed state.
//
// Spec 059 reproduced this bug: `claimFirstAdminBootstrap` committed the `_forge_bootstrap` claim, and
// only then did `create()` insert the user. If that second write failed, the claim stayed forever with
// no administrator behind it, and every later signup became `viewer`.

const BOOTSTRAP = '_forge_bootstrap';

/**
 * Makes user creation fail *wherever it happens*, after everything that precedes it has succeeded:
 * - a plain `create()` on the users collection throws (the pre-spec-060 shape: claim, then create);
 * - an `atomicWrite()` that creates a user gets one more operation appended — a second user with the
 *   same email — so the users unique index rejects it AFTER the claim and the first user succeeded.
 * A wrapper that merely refused the whole call would prove nothing about rollback.
 */
function failUserCreation<T extends object>(database: T, usersSlug: string) {
  const state = { armed: true };
  const proxy = new Proxy(database, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      if (state.armed && property === 'create') {
        return async (collection: string, ...rest: unknown[]) => {
          if (collection === usersSlug) throw new Error('injected: user create failed');
          return method.call(target, collection, ...rest);
        };
      }
      if (state.armed && property === 'atomicWrite') {
        return async (operations: { type: string; collection: string; data?: object }[]) => {
          const userCreate = operations.find(
            (o) => o.type === 'create' && o.collection === usersSlug
          );
          const sabotaged = userCreate
            ? [
                ...operations,
                {
                  ...userCreate,
                  data: { ...userCreate.data, id: 'injected-duplicate' }
                }
              ]
            : operations;
          return method.call(target, sabotaged);
        };
      }
      return method.bind(target);
    }
  });
  return { database: proxy, disarm: () => (state.armed = false) };
}

async function freshInstall() {
  const store = new InMemoryDatabaseAdapter();
  await store.syncSchema([defineUsersCollection()]);
  return store;
}

const bootstrapClaims = (db: DatabaseAdapter) => db.count(BOOTSTRAP);
const userCount = (db: DatabaseAdapter) => db.count('users');

describe('first-admin provisioning is all-or-nothing (spec 060)', () => {
  for (const flow of ['signup', 'createUser'] as const) {
    it(`${flow}: a failed first-user creation does not burn the bootstrap claim`, async () => {
      const store = await freshInstall();
      const { database, disarm } = failUserCreation(store, 'users');
      const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({
        userDatabase: database as DatabaseAdapter
      });

      const failed = await auth[flow]({ email: 'owner@example.com', password: 'password123' }).then(
        (result) => result,
        (error: unknown) => error
      );
      expect(failed).not.toMatchObject({ ok: true });

      // Nothing at all was committed: no user, and — the bug — no claim either.
      expect(await userCount(store)).toBe(0);
      expect(await bootstrapClaims(store)).toBe(0);

      // The opportunity is intact: the next valid first user still becomes the administrator.
      disarm();
      const retry = await auth[flow]({ email: 'owner@example.com', password: 'password123' });
      if (!retry.ok) throw new Error(`expected the retry to succeed, got ${retry.reason}`);
      expect(retry.user.role).toBe('admin');
      expect(await userCount(store)).toBe(1);
      expect(await bootstrapClaims(store)).toBe(1);
    });
  }
});
