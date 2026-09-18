import { env } from 'cloudflare:workers';
import { describe } from 'vitest';
import { runLastAdminConcurrencyContractTests } from '@forge-cms/testing/contracts';
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

/**
 * Spec 059's real-D1 proof, inside workerd against Miniflare's actual local D1 (SQLite) — not the
 * hand-rolled SQL interpreter the unit-test mock uses, which cannot evaluate the guard's cross-row
 * `COUNT(*)` subquery. Every party is its own `D1DatabaseAdapter` + its own
 * `UsersCollectionAuthAdapter` over the one shared binding, i.e. as independent as two Worker isolates
 * are from the code's point of view (nothing is shared between them but the database). The write gate
 * holds all parties between "finished reading/deciding" and "write", so the decision must come from
 * the D1 statement itself. Each test uses its own users-collection name, so the shared per-file D1
 * needs no cleanup.
 */
describe('UsersCollectionAuthAdapter — real local D1 binding: last-admin invariant under concurrent writers', () => {
  runLastAdminConcurrencyContractTests(async ({ collection, parties, gate }) => {
    const contenderFor = async (slug: string) => {
      const database = new D1DatabaseAdapter().init(env);
      await database.syncSchema([defineUsersCollection({ slug })]);
      const gated = gate.wrap(database);
      const users = new UsersCollectionAuthAdapter({ devMode: true, collection: slug }).init({
        userDatabase: gated
      });
      return { users, database: gated };
    };

    return {
      contenders: await Promise.all(
        Array.from({ length: parties }, () => contenderFor(collection))
      ),
      contenderFor
    };
  });
});
