import { env } from 'cloudflare:workers';
import { runSchemaDriftContractTests } from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 070 — the same schema drift contract on the real local D1 binding (workerd). Every `open()` is
// a new adapter instance over the one D1 database; tables are prefixed per test.

runSchemaDriftContractTests('D1DatabaseAdapter (real local D1 binding)', () =>
  Promise.resolve({
    open: () => Promise.resolve(new D1DatabaseAdapter().init(env)),
    query: async (sql: string) =>
      (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
    exec: async (sql: string) => {
      await env.DB.prepare(sql).run();
    }
  })
);
