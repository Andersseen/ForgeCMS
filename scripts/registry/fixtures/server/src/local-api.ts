// Local API journey against the database the HTTP server left behind (a separate process: persistence).
import { createRuntime } from './runtime.js';

const { runtime, auth } = await createRuntime();
const login = await auth.login('admin@example.test', 'registry-consumer-passphrase');
if (!login.ok) throw new Error('admin cannot sign in after restart');
const admin = login.user;
const viewerLogin = await auth.login('viewer@example.test', 'registry-consumer-passphrase');
if (!viewerLogin.ok) throw new Error('viewer cannot sign in');

// Published-only by default; drafts need status: 'all'.
const published = await runtime.find({ collection: 'posts', overrideAccess: false });
const everything = await runtime.find({
  collection: 'posts',
  status: 'all',
  overrideAccess: false,
  user: admin
});
console.log(`local:published=${published.docs.length} all=${everything.docs.length}`);

const created = await runtime.create({
  collection: 'posts',
  data: { title: 'Local API post', author: admin.id, views: 1 },
  user: admin,
  overrideAccess: false
});
const updated = await runtime.update({
  collection: 'posts',
  id: String(created['id']),
  data: { views: 2, _status: 'published' },
  user: admin,
  overrideAccess: false
});
const read = await runtime.findByID({
  collection: 'posts',
  id: String(created['id']),
  overrideAccess: false
});
console.log(`local:updated views=${String(updated['views'])} read=${String(read?.['title'])}`);

let denied = 'allowed';
try {
  await runtime.create({
    collection: 'posts',
    data: { title: 'viewer write', author: admin.id },
    user: viewerLogin.user,
    overrideAccess: false
  });
} catch (error) {
  denied = (error as Error).name;
}
console.log(`local:viewer-create=${denied}`);

let invalid = 'accepted';
try {
  await runtime.create({
    collection: 'posts',
    data: { author: admin.id },
    user: admin,
    overrideAccess: false
  });
} catch (error) {
  invalid = (error as Error).name;
}
console.log(`local:missing-title=${invalid}`);

await runtime.delete({
  collection: 'posts',
  id: String(created['id']),
  user: admin,
  overrideAccess: false
});
let gone = 'still readable';
try {
  await runtime.findByID({ collection: 'posts', id: String(created['id']), overrideAccess: false });
} catch (error) {
  gone = (error as Error).name;
}
console.log(`local:deleted=${gone}`);
