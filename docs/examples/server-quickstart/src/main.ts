import { randomBytes } from 'node:crypto';
import { notesApi } from './handlers.js';
import { createRuntime } from './runtime.js';

const env = {
  AUTH_SECRET: process.env['AUTH_SECRET'] ?? randomBytes(32).toString('base64'),
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'file:./forge.db'
};
const { runtime, auth } = await createRuntime(env);

// First admin: the very first user ever created is always an admin.
const existing = await auth.listUsers();
const first =
  existing.length === 0
    ? await auth.createUser({ email: 'admin@example.com', password: 'a-long-passphrase' })
    : undefined;
if (first && !first.ok) throw new Error(`could not create the first admin: ${first.reason}`);

const login = await auth.login('admin@example.com', 'a-long-passphrase');
if (!login.ok) throw new Error('sign-in failed (is this database from an earlier run?)');
const admin = login.user;

// Local API with the admin's access rules enforced (`overrideAccess: false`).
const note = await runtime.create({
  collection: 'notes',
  data: { title: 'Hello ForgeCMS', body: 'First note', author: admin.id },
  user: admin,
  overrideAccess: false
});

const found = await runtime.find({
  collection: 'notes',
  where: { title: 'Hello ForgeCMS' }
});
console.log('Local API:', found.docs.length, 'note(s), first id', String(note.id));

// The same data over the framework-agnostic HTTP handlers.
const response = await notesApi(runtime, env).list(new Request('http://localhost/api/v1/notes'));
const body = (await response.json()) as { data: unknown[]; meta: { totalDocs: number } };
console.log('HTTP handler:', response.status, body.meta.totalDocs, 'note(s)');

// Anonymous callers can read, but may not write.
try {
  await runtime.create({
    collection: 'notes',
    data: { title: 'Nope', author: admin.id },
    user: null,
    overrideAccess: false
  });
  throw new Error('anonymous create was allowed');
} catch (error) {
  console.log('Anonymous create refused:', (error as Error).name);
}
