/**
 * **This file is the playground.** Edit it, save, and the page re-runs everything below.
 *
 * It builds a real `ForgeCmsRuntime` on in-memory adapters — the whole pipeline (access control,
 * hooks, drafts, validation, relation population) with no server, no database and no HTTP. Use it to
 * try an idea in seconds before deciding whether it belongs in a package, in `apps/demo-aesthetics`
 * (the realistic demo) or in a spec.
 *
 * Nothing here is a test or a demo: it is a scratchpad. Break it freely.
 */
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { posts } from './posts.collection';

// --- 1. Collections to play with ----------------------------------------------------------------

const users = defineCollection({
  slug: 'users',
  fields: {
    name: defineField.text({ required: true }),
    email: defineField.email()
  }
});

const notes = defineCollection({
  slug: 'notes',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    body: defineField.textarea(),
    pinned: defineField.boolean({ defaultValue: false }),
    author: defineField.relation({ collection: 'users' })
  },
  access: {
    // Anonymous readers only see pinned notes — a one-line example of a row-level rule.
    read: ({ user }) => (user ? true : { pinned: { eq: true } })
  },
  hooks: {
    beforeChange: [
      ({ data, overrideAccess }) => ({
        ...data,
        // `overrideAccess` is `true` for direct calls like these, so this branch shows what a
        // trusted server-side write looks like to a hook.
        body: overrideAccess ? data.body : `${String(data.body ?? '')} (from the network)`
      })
    ]
  }
});

const collections = [posts, users, notes];

// --- 2. A fresh runtime per run -----------------------------------------------------------------

export async function createSandboxRuntime(): Promise<ForgeCmsRuntime> {
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });

  runtime.init();
  await runtime.syncSchema();
  return runtime;
}

// --- 3. Scenarios ------------------------------------------------------------------------------

export interface Scenario {
  name: string;
  /** Whatever you return is shown as JSON. Throw to see the error instead. */
  run: (cms: ForgeCmsRuntime) => Promise<unknown>;
}

export const scenarios: Scenario[] = [
  {
    name: 'create + find',
    run: async (cms) => {
      const author = await cms.create({
        collection: 'users',
        data: { name: 'Andrii', email: 'andrii@example.com' }
      });

      await cms.create({
        collection: 'notes',
        data: {
          title: 'Hello from the playground',
          body: 'Edit sandbox.ts',
          pinned: true,
          author: author.id
        }
      });

      return cms.find({ collection: 'notes', depth: 1 });
    }
  },
  {
    name: 'drafts are invisible to anonymous readers',
    run: async (cms) => {
      await cms.create({
        collection: 'notes',
        data: { title: 'Published note', pinned: true, _status: 'published' }
      });
      await cms.create({ collection: 'notes', data: { title: 'Still a draft', pinned: true } });

      const anonymous = await cms.find({ collection: 'notes', overrideAccess: false, user: null });
      const serverSide = await cms.find({ collection: 'notes' });

      return {
        anonymous: anonymous.docs.map((doc) => doc.title),
        serverSide: serverSide.docs.map((doc) => doc.title)
      };
    }
  },
  {
    name: 'row-level access narrows the query',
    run: async (cms) => {
      await cms.create({
        collection: 'notes',
        data: { title: 'Pinned', pinned: true, _status: 'published' }
      });
      await cms.create({
        collection: 'notes',
        data: { title: 'Not pinned', pinned: false, _status: 'published' }
      });

      const anonymous = await cms.find({ collection: 'notes', overrideAccess: false, user: null });
      return { totalDocs: anonymous.totalDocs, titles: anonymous.docs.map((doc) => doc.title) };
    }
  },
  {
    name: 'slug and defaults come from the schema',
    run: async (cms) =>
      cms.create({ collection: 'notes', data: { title: 'Láser & Piel: sesión 2' } })
  },
  {
    name: 'validation rejects a bad document',
    run: async (cms) => cms.create({ collection: 'notes', data: { body: 'no title' } })
  }
];
