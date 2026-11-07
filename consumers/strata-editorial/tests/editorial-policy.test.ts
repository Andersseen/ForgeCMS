import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { describe, expect, it } from 'vitest';

import { collections, posts, users } from '../src/app/cms/collections';
import { EditorialService } from '../src/app/cms/editorial.service';
import type { Editor } from '../src/app/cms/editorial.service';
import { resolveProfile } from '../src/app/cms/runtime';
import { CANARIES, EDITORS, POSTS } from '../scripts/fixture';

const SECRET = CANARIES.authSecret;

async function world(definitions: readonly CollectionDefinition[]) {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({
    AUTH_SECRET: SECRET,
    userDatabase: database
  });
  const runtime = new ForgeCmsRuntime({
    collections: [...definitions],
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { AUTH_SECRET: SECRET }
  });
  runtime.init();
  await runtime.syncSchema();
  const editors = {} as Record<keyof typeof EDITORS, Editor & { token: string }>;
  for (const [key, input] of Object.entries(EDITORS) as [
    keyof typeof EDITORS,
    (typeof EDITORS)[keyof typeof EDITORS]
  ][]) {
    const created = await auth.createUser(input);
    if (!created.ok) throw new Error(created.reason);
    const login = await auth.login(input.email, input.password);
    if (!login.ok) throw new Error(login.reason);
    editors[key] = {
      id: created.user.id,
      role: created.user.role ?? '',
      name: input.name,
      token: login.token
    };
  }
  const ids: Record<string, string> = {};
  for (const post of POSTS) {
    const doc = await runtime.create({
      collection: 'posts',
      data: {
        title: post.title,
        slug: post.slug,
        body: [{ type: 'paragraph', children: [{ type: 'text', text: post.text }] }],
        author: editors[post.author].id,
        _status: post.status
      }
    });
    ids[post.slug] = String((doc as { id: string }).id);
  }
  return { service: new EditorialService(runtime as never), editors, ids };
}

/** The access policy as executable expectations. Returns every violation (empty = policy holds). */
async function policyViolations(definitions: readonly CollectionDefinition[]): Promise<string[]> {
  const { service, editors, ids } = await world(definitions);
  const violations: string[] = [];
  const expectRead = async (
    label: string,
    editor: Editor | null,
    slug: string,
    visible: boolean
  ) => {
    const bySlug = await service.readBySlug(slug, editor);
    const byId = await service.readById(ids[slug] ?? '', editor);
    if (Boolean(bySlug) !== visible || Boolean(byId) !== visible)
      violations.push(`${label}: ${slug}`);
  };
  await expectRead('anonymous sees published', null, 'welcome-to-the-desk', true);
  await expectRead('anonymous never sees a draft', null, 'ana-draft-investigation', false);
  await expectRead('viewer never sees a draft', editors.vic, 'ana-draft-investigation', false);
  await expectRead('editor sees own draft', editors.ana, 'ana-draft-investigation', true);
  await expectRead(
    'editor never sees another editor’s draft',
    editors.ben,
    'ana-draft-investigation',
    false
  );
  await expectRead(
    'editor never sees another editor’s draft',
    editors.ana,
    'ben-draft-column',
    false
  );
  await expectRead('admin sees every draft', editors.ada, 'ben-draft-column', true);

  const listed = await service.listPublished();
  if (listed.some((post) => post.slug.includes('draft'))) violations.push('list exposes a draft');

  const anaDraft = ids['ana-draft-investigation'] ?? '';
  if ((await service.changeStatus(anaDraft, 'published', editors.ben)).kind !== 'not-found')
    violations.push('editor publishes another editor’s post');
  if ((await service.changeStatus(anaDraft, 'published', editors.vic)).kind !== 'not-found')
    violations.push('viewer publishes');
  if ((await service.changeStatus(anaDraft, 'published', null)).kind !== 'unauthenticated')
    violations.push('anonymous publishes');
  if ((await service.changeStatus(anaDraft, 'archived', editors.ana)).kind !== 'invalid')
    violations.push('invalid status accepted');
  // The update rule on its own: Ben CAN read Ana's published post, so only `update` access can refuse him.
  const anaPublished = ids['welcome-to-the-desk'] ?? '';
  if ((await service.changeStatus(anaPublished, 'draft', editors.ben)).kind !== 'not-found') {
    violations.push('editor publishes another editor’s post');
  }
  if ((await service.readBySlug('welcome-to-the-desk', null)) === null) {
    violations.push('refused unpublish changed visibility');
  }
  if ((await service.readBySlug('ana-draft-investigation', null)) !== null)
    violations.push('refused writes changed visibility');
  return violations;
}

describe('editorial access policy (ForgeCMS Local API through EditorialService)', () => {
  it('holds for the shipped collections', async () => {
    expect(await policyViolations(collections)).toEqual([]);
  });

  it('NEGATIVE CONTROL: a weakened read rule is detected', async () => {
    const leaky = {
      ...posts,
      access: { ...posts.access, read: () => true }
    } as CollectionDefinition;
    const violations = await policyViolations([users, leaky]);
    expect(violations).toContain(
      'editor never sees another editor’s draft: ana-draft-investigation'
    );
  });

  it('NEGATIVE CONTROL: a weakened update rule is detected', async () => {
    const leaky = {
      ...posts,
      access: { ...posts.access, update: () => true }
    } as CollectionDefinition;
    expect(await policyViolations([users, leaky])).toContain(
      'editor publishes another editor’s post'
    );
  });

  it('resolves identity only from a valid session, never from other headers', async () => {
    const { service, editors } = await world(collections);
    expect(await service.resolveEditor(new Headers({ 'x-user-id': editors.ada.id }))).toBeNull();
    expect(
      await service.resolveEditor(new Headers({ authorization: 'Bearer forged.token.value' }))
    ).toBeNull();
    expect(
      await service.resolveEditor(new Headers({ cookie: `forge_session=${editors.ben.token}` }))
    ).toMatchObject({
      id: editors.ben.id,
      role: 'editor'
    });
  });

  it('public projections never carry author emails or raw rows', async () => {
    const { service, editors } = await world(collections);
    const view = await service.readBySlug('ana-draft-investigation', editors.ana);
    expect(JSON.stringify(view)).not.toContain('@editorial.test');
    expect(Object.keys(view ?? {}).sort()).toEqual(
      [
        'byline',
        'canChangeStatus',
        'id',
        'paragraphs',
        'slug',
        'status',
        'summary',
        'title',
        'updatedAt'
      ].sort()
    );
  });
});

describe('deployment profile', () => {
  it('refuses a production start without a durable database', () => {
    expect(() => resolveProfile({}, false)).toThrow(/No durable editorial profile/);
    expect(() => resolveProfile({ DATABASE_URL: 'file:a.db', DB: {} as never }, false)).toThrow(
      /ambiguous/
    );
    expect(resolveProfile({ DATABASE_URL: 'file:a.db' }, false)).toBe('portable');
    expect(resolveProfile({ DB: {} as never }, false)).toBe('cloudflare');
    expect(resolveProfile({}, true)).toBe('development');
  });
});
