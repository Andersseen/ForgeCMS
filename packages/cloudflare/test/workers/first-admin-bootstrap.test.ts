import { env } from 'cloudflare:workers';
import { describe } from 'vitest';
import { runFirstAdminBootstrapContractTests } from '@forge-cms/testing/contracts';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

/**
 * Spec 060's real-D1 proof, inside workerd against Miniflare's actual local D1 (SQLite). Every party is
 * its own `D1DatabaseAdapter` + its own `UsersCollectionAuthAdapter` over the one shared binding — as
 * independent as two Worker isolates are from the code's point of view (nothing is shared between them
 * but the database). The first-admin provisioning is one real D1 `batch()`, and the barrier holds every
 * party at its first write, so which caller becomes admin — and whether a failed creation rolls the claim
 * back — is decided by D1 itself. Each test uses its own users-collection name (the claim is keyed by
 * it), so the shared per-file D1 needs no cleanup.
 */
describe('UsersCollectionAuthAdapter — real local D1 binding: first-admin provisioning (spec 060)', () => {
  runFirstAdminBootstrapContractTests(async ({ collection, parties, wrap }) => {
    const contender = async () => {
      const database = new D1DatabaseAdapter().init(env);
      await database.syncSchema([defineUsersCollection({ slug: collection })]);
      return {
        users: new UsersCollectionAuthAdapter({ devMode: true, collection }).init({
          userDatabase: wrap(database)
        }),
        database
      };
    };

    return { contenders: await Promise.all(Array.from({ length: parties }, contender)) };
  });
});
