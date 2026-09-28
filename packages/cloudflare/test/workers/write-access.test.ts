import { env } from 'cloudflare:workers';
import { describe } from 'vitest';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { runWriteAccessContractTests, writeAccessSchema } from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 068's real-D1 evidence, inside workerd against Miniflare's local D1 (SQLite): the caller and the
// independent writer are two runtimes over two `D1DatabaseAdapter`s on the one binding. Local workerd,
// not production D1.

function runtimeOver(
  database: D1DatabaseAdapter,
  collections: CollectionDefinition[],
  globals: GlobalDefinition[]
) {
  const runtime = new ForgeCmsRuntime({
    env,
    collections,
    globals,
    adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

describe('D1DatabaseAdapter — real local D1 binding: write-time access queries', () => {
  runWriteAccessContractTests(async ({ prefix, hold }) => {
    const { collections, globals } = writeAccessSchema(prefix);
    const caller = runtimeOver(hold.wrap(new D1DatabaseAdapter().init(env)), collections, globals);
    const mover = runtimeOver(new D1DatabaseAdapter().init(env), collections, globals);
    await caller.syncSchema();
    await mover.syncSchema();
    return { contenders: [caller, mover], database: mover.adapters.database };
  });
});
