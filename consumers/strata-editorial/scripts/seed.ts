// Seeds a FRESH durable database with the synthetic qualification fixture through the ForgeCMS Local API.
// Usage: DATABASE_URL=file:./data/editorial.db AUTH_SECRET=… node --experimental-strip-types scripts/seed.ts
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections } from '../src/app/cms/collections.ts';
import { EDITORS, POSTS } from './fixture.ts';

const url = process.env['DATABASE_URL'];
const secret = process.env['AUTH_SECRET'];
if (!url || !secret) throw new Error('DATABASE_URL and AUTH_SECRET are required.');

const database = new LibSqlDatabaseAdapter(url);
const auth = new UsersCollectionAuthAdapter({ devMode: false }).init({
  AUTH_SECRET: secret,
  userDatabase: database
});
const runtime = new ForgeCmsRuntime({
  collections,
  adapters: { database, auth, storage: new InMemoryStorageAdapter() },
  env: { AUTH_SECRET: secret, DATABASE_URL: url }
});
runtime.init();
await runtime.syncSchema();

if ((await runtime.count({ collection: 'users' })) > 0) {
  throw new Error(
    'Refusing to seed: the database already has users (seed only a fresh qualification database).'
  );
}

const ids: Record<string, string> = {};
for (const [key, editor] of Object.entries(EDITORS)) {
  const result = await auth.createUser(editor);
  if (!result.ok) throw new Error(`Could not create ${key}: ${result.reason}`);
  if (result.user.role !== editor.role) {
    throw new Error(
      `${key} was provisioned as ${String(result.user.role)}, expected ${editor.role}`
    );
  }
  ids[key] = result.user.id;
}
for (const post of POSTS) {
  await runtime.create({
    collection: 'posts',
    data: {
      title: post.title,
      slug: post.slug,
      summary: `${post.title}.`,
      body: [{ type: 'paragraph', children: [{ type: 'text', text: post.text }] }],
      author: ids[post.author],
      _status: post.status
    }
  });
}
console.log(`seeded ${Object.keys(ids).length} users and ${POSTS.length} posts`);
