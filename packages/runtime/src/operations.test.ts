import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CmsUser } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { AccessDeniedError, NotFoundError, ValidationFailedError } from './errors.js';

const admin: CmsUser = { id: 'u-admin', role: 'admin' };
const author: CmsUser = { id: 'u-author', role: 'editor' };
const otherAuthor: CmsUser = { id: 'u-other', role: 'editor' };

function buildRuntime(collections: Parameters<typeof defineCollection>[0][]) {
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    views: defineField.number()
  }
});

describe('Local API — find', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = buildRuntime([posts]);
    for (const [i, title] of ['A', 'B', 'C', 'D', 'E'].entries()) {
      await runtime.create({ collection: 'posts', data: { title, views: i * 10 } });
    }
  });

  it('returns docs plus pagination metadata', async () => {
    const result = await runtime.find({ collection: 'posts', limit: 2, offset: 0 });

    expect(result.docs).toHaveLength(2);
    expect(result.totalDocs).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(1);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(false);
  });

  it('reports the total ignoring limit/offset — the bug pagination metadata exists to fix', async () => {
    const result = await runtime.find({ collection: 'posts', limit: 2, offset: 2 });

    expect(result.docs).toHaveLength(2);
    expect(result.totalDocs).toBe(5);
    expect(result.page).toBe(2);
    expect(result.hasPrevPage).toBe(true);
    expect(result.hasNextPage).toBe(true);
  });

  it('marks the last page as having no next page', async () => {
    const result = await runtime.find({ collection: 'posts', limit: 2, offset: 4 });
    expect(result.hasNextPage).toBe(false);
    expect(result.page).toBe(3);
  });

  it('counts only matching documents when filtered', async () => {
    const result = await runtime.find({
      collection: 'posts',
      where: { views: { gte: 30 } },
      limit: 1
    });
    expect(result.totalDocs).toBe(2);
    expect(result.docs).toHaveLength(1);
  });

  it('reports a single page when unpaginated', async () => {
    const result = await runtime.find({ collection: 'posts' });
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
    expect(result.hasNextPage).toBe(false);
  });

  it('throws NotFoundError for an unknown collection', async () => {
    await expect(runtime.find({ collection: 'nope' })).rejects.toThrow(NotFoundError);
  });
});

describe('Local API — write operations', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(() => {
    runtime = buildRuntime([posts]);
  });

  it('creates, reads, updates and deletes without any HTTP involved', async () => {
    const created = await runtime.create({ collection: 'posts', data: { title: 'Hello' } });
    expect(created.id).toBeTruthy();

    const read = await runtime.findByID({ collection: 'posts', id: created.id as string });
    expect(read.title).toBe('Hello');

    const updated = await runtime.update({
      collection: 'posts',
      id: created.id as string,
      data: { title: 'Goodbye' }
    });
    expect(updated.title).toBe('Goodbye');

    const deleted = await runtime.delete({ collection: 'posts', id: created.id as string });
    expect(deleted.id).toBe(created.id);

    await expect(
      runtime.findByID({ collection: 'posts', id: created.id as string })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationFailedError carrying field-level details', async () => {
    await expect(runtime.create({ collection: 'posts', data: {} })).rejects.toThrow(
      ValidationFailedError
    );

    try {
      await runtime.create({ collection: 'posts', data: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationFailedError);
      expect((err as ValidationFailedError).details[0]?.field).toBe('title');
      expect((err as ValidationFailedError).status).toBe(400);
    }
  });

  it('does not require fields already stored on a partial update', async () => {
    const created = await runtime.create({ collection: 'posts', data: { title: 'Hello' } });
    const updated = await runtime.update({
      collection: 'posts',
      id: created.id as string,
      data: { views: 5 }
    });
    expect(updated.title).toBe('Hello');
    expect(updated.views).toBe(5);
  });

  it('404s a delete of a document that does not exist', async () => {
    await expect(runtime.delete({ collection: 'posts', id: 'ghost' })).rejects.toThrow(
      NotFoundError
    );
  });

  it('counts documents matching a filter', async () => {
    await runtime.create({ collection: 'posts', data: { title: 'A', views: 1 } });
    await runtime.create({ collection: 'posts', data: { title: 'B', views: 9 } });

    expect(await runtime.count({ collection: 'posts' })).toBe(2);
    expect(await runtime.count({ collection: 'posts', where: { views: { gt: 5 } } })).toBe(1);
  });
});

describe('Local API — overrideAccess', () => {
  const locked = defineCollection({
    slug: 'locked',
    fields: { title: defineField.text() },
    access: { read: () => false, create: () => false }
  });

  it('skips access control by default, because a direct call is trusted server code', async () => {
    const runtime = buildRuntime([locked]);
    await expect(
      runtime.create({ collection: 'locked', data: { title: 'x' } })
    ).resolves.toBeTruthy();
    await expect(runtime.find({ collection: 'locked' })).resolves.toBeTruthy();
  });

  it('enforces access control when overrideAccess is false', async () => {
    const runtime = buildRuntime([locked]);
    await expect(
      runtime.create({ collection: 'locked', data: { title: 'x' }, overrideAccess: false })
    ).rejects.toThrow(AccessDeniedError);
  });
});

describe('Access control as functions (spec 020)', () => {
  const ownedPosts = defineCollection({
    slug: 'owned',
    fields: {
      title: defineField.text({ required: true }),
      ownerId: defineField.text()
    },
    access: {
      // The row-level rule that role arrays cannot express: everyone reads, but you only
      // update/delete what you own — unless you are an admin.
      read: () => true,
      update: ({ user }) => (user?.role === 'admin' ? true : { ownerId: user?.id }),
      delete: ({ user }) => (user?.role === 'admin' ? true : { ownerId: user?.id })
    }
  });

  let runtime: ForgeCmsRuntime;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    runtime = buildRuntime([ownedPosts]);
    mine = (
      await runtime.create({ collection: 'owned', data: { title: 'Mine', ownerId: author.id } })
    ).id as string;
    theirs = (
      await runtime.create({
        collection: 'owned',
        data: { title: 'Theirs', ownerId: otherAuthor.id }
      })
    ).id as string;
  });

  it('lets an author update their own document', async () => {
    const updated = await runtime.update({
      collection: 'owned',
      id: mine,
      data: { title: 'Mine, edited' },
      user: author,
      overrideAccess: false
    });
    expect(updated.title).toBe('Mine, edited');
  });

  it("denies an author updating someone else's document", async () => {
    await expect(
      runtime.update({
        collection: 'owned',
        id: theirs,
        data: { title: 'hijacked' },
        user: author,
        overrideAccess: false
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("denies an author deleting someone else's document", async () => {
    await expect(
      runtime.delete({ collection: 'owned', id: theirs, user: author, overrideAccess: false })
    ).rejects.toThrow(AccessDeniedError);
  });

  it('lets an admin through the same rule', async () => {
    await expect(
      runtime.update({
        collection: 'owned',
        id: theirs,
        data: { title: 'moderated' },
        user: admin,
        overrideAccess: false
      })
    ).resolves.toBeTruthy();
  });

  it('AND-merges a read constraint into the query instead of denying outright', async () => {
    const scoped = defineCollection({
      slug: 'scoped',
      fields: { title: defineField.text(), ownerId: defineField.text() },
      access: { read: ({ user }) => ({ ownerId: user?.id }) }
    });
    const scopedRuntime = buildRuntime([scoped]);
    await scopedRuntime.create({ collection: 'scoped', data: { title: 'A', ownerId: author.id } });
    await scopedRuntime.create({
      collection: 'scoped',
      data: { title: 'B', ownerId: otherAuthor.id }
    });

    const result = await scopedRuntime.find({
      collection: 'scoped',
      user: author,
      overrideAccess: false
    });

    expect(result.docs).toHaveLength(1);
    expect(result.docs[0]?.title).toBe('A');
    // The total has to respect the constraint too, or the paginator lies about how much exists.
    expect(result.totalDocs).toBe(1);
  });

  it('404s rather than 403s a single read the user may not reach, so ids do not leak', async () => {
    const scoped = defineCollection({
      slug: 'scoped2',
      fields: { title: defineField.text(), ownerId: defineField.text() },
      access: { read: ({ user }) => ({ ownerId: user?.id }) }
    });
    const scopedRuntime = buildRuntime([scoped]);
    const hidden = (
      await scopedRuntime.create({
        collection: 'scoped2',
        data: { title: 'Secret', ownerId: otherAuthor.id }
      })
    ).id as string;

    await expect(
      scopedRuntime.findByID({
        collection: 'scoped2',
        id: hidden,
        user: author,
        overrideAccess: false
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('still supports role arrays unchanged', async () => {
    const adminOnly = defineCollection({
      slug: 'admin_only',
      fields: { title: defineField.text() },
      access: { create: ['admin'] }
    });
    const r = buildRuntime([adminOnly]);

    await expect(
      r.create({
        collection: 'admin_only',
        data: { title: 'x' },
        user: admin,
        overrideAccess: false
      })
    ).resolves.toBeTruthy();
    await expect(
      r.create({
        collection: 'admin_only',
        data: { title: 'x' },
        user: author,
        overrideAccess: false
      })
    ).rejects.toThrow(AccessDeniedError);
  });
});

describe('Hook pipeline (spec 021)', () => {
  it('runs the write pipeline in order', async () => {
    const order: string[] = [];
    const tracked = defineCollection({
      slug: 'tracked',
      fields: { title: defineField.text({ required: true }) },
      hooks: {
        beforeOperation: [() => void order.push('beforeOperation')],
        beforeValidate: [(ctx) => (order.push('beforeValidate'), ctx.data)],
        beforeChange: [(ctx) => (order.push('beforeChange'), ctx.data)],
        afterChange: [() => void order.push('afterChange')],
        afterRead: [(ctx) => (order.push('afterRead'), ctx.doc)],
        afterOperation: [() => void order.push('afterOperation')]
      }
    });

    const runtime = buildRuntime([tracked]);
    await runtime.create({ collection: 'tracked', data: { title: 'A' } });

    expect(order).toEqual([
      'beforeOperation',
      'beforeValidate',
      'beforeChange',
      'afterChange',
      'afterRead',
      'afterOperation'
    ]);
  });

  it('lets beforeValidate supply a value that then satisfies validation', async () => {
    const slugged = defineCollection({
      slug: 'slugged',
      fields: {
        title: defineField.text({ required: true }),
        slug: defineField.slug({ required: true })
      },
      hooks: {
        beforeValidate: [
          (ctx) => ({
            ...ctx.data,
            slug: ctx.data.slug ?? String(ctx.data.title).toLowerCase().replace(/\s+/g, '-')
          })
        ]
      }
    });

    const runtime = buildRuntime([slugged]);
    const doc = await runtime.create({ collection: 'slugged', data: { title: 'Hello World' } });
    expect(doc.slug).toBe('hello-world');
  });

  it('lets beforeRead narrow the query', async () => {
    const filtered = defineCollection({
      slug: 'filtered',
      fields: { title: defineField.text(), archived: defineField.boolean() },
      hooks: { beforeRead: [(ctx) => ({ ...ctx.query, archived: false })] }
    });

    const runtime = buildRuntime([filtered]);
    await runtime.create({ collection: 'filtered', data: { title: 'live', archived: false } });
    await runtime.create({ collection: 'filtered', data: { title: 'gone', archived: true } });

    const result = await runtime.find({ collection: 'filtered' });
    expect(result.docs.map((d) => d.title)).toEqual(['live']);
  });

  it('lets afterRead transform each document', async () => {
    const computed = defineCollection({
      slug: 'computed',
      fields: { first: defineField.text(), last: defineField.text() },
      hooks: {
        afterRead: [(ctx) => ({ ...ctx.doc, fullName: `${ctx.doc.first} ${ctx.doc.last}` })]
      }
    });

    const runtime = buildRuntime([computed]);
    await runtime.create({ collection: 'computed', data: { first: 'Ada', last: 'Lovelace' } });

    const result = await runtime.find({ collection: 'computed' });
    expect(result.docs[0]?.fullName).toBe('Ada Lovelace');
  });

  it('aborts a delete when beforeDelete throws', async () => {
    const guarded = defineCollection({
      slug: 'guarded',
      fields: { title: defineField.text(), locked: defineField.boolean() },
      hooks: {
        beforeDelete: [
          (ctx) => {
            if (ctx.doc.locked === true) throw new Error('document is locked');
          }
        ]
      }
    });

    const runtime = buildRuntime([guarded]);
    const doc = await runtime.create({
      collection: 'guarded',
      data: { title: 'x', locked: true }
    });

    await expect(runtime.delete({ collection: 'guarded', id: doc.id as string })).rejects.toThrow(
      'document is locked'
    );

    // The guard actually prevented the write, it did not just report an error after the fact.
    await expect(
      runtime.findByID({ collection: 'guarded', id: doc.id as string })
    ).resolves.toBeTruthy();
  });

  it('runs afterDelete with the document that was removed', async () => {
    const seen: unknown[] = [];
    const audited = defineCollection({
      slug: 'audited',
      fields: { title: defineField.text() },
      hooks: { afterDelete: [(ctx) => void seen.push(ctx.doc.title)] }
    });

    const runtime = buildRuntime([audited]);
    const doc = await runtime.create({ collection: 'audited', data: { title: 'bye' } });
    await runtime.delete({ collection: 'audited', id: doc.id as string });

    expect(seen).toEqual(['bye']);
  });

  it('does not let a failing afterChange hook fail an already-committed write', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const flaky = defineCollection({
      slug: 'flaky',
      fields: { title: defineField.text() },
      hooks: {
        afterChange: [
          () => {
            throw new Error('webhook down');
          }
        ]
      }
    });

    const runtime = buildRuntime([flaky]);
    await expect(
      runtime.create({ collection: 'flaky', data: { title: 'x' } })
    ).resolves.toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('runs field-level hooks', async () => {
    const withFieldHooks = defineCollection({
      slug: 'field_hooks',
      fields: {
        title: defineField.text({
          hooks: { beforeChange: [({ value }) => String(value).trim()] }
        }),
        shout: defineField.text({
          hooks: { afterRead: [({ data }) => `${String(data.title).toUpperCase()}!`] }
        })
      }
    });

    const runtime = buildRuntime([withFieldHooks]);
    const created = await runtime.create({
      collection: 'field_hooks',
      data: { title: '  spaced  ' }
    });

    expect(created.title).toBe('spaced');
    expect(created.shout).toBe('SPACED!');
  });
});

describe('Drafts through the Local API', () => {
  const drafted = defineCollection({
    slug: 'drafted',
    fields: { title: defineField.text({ required: true }) },
    drafts: true
  });

  it('defaults new documents to draft', async () => {
    const runtime = buildRuntime([drafted]);
    const doc = await runtime.create({ collection: 'drafted', data: { title: 'WIP' } });
    expect(doc._status).toBe('draft');
  });

  it('hides drafts from anonymous listings but shows them to trusted server code', async () => {
    const runtime = buildRuntime([drafted]);
    await runtime.create({ collection: 'drafted', data: { title: 'WIP' } });
    await runtime.create({
      collection: 'drafted',
      data: { title: 'Live', _status: 'published' }
    });

    const anonymous = await runtime.find({ collection: 'drafted', overrideAccess: false });
    expect(anonymous.docs.map((d) => d.title)).toEqual(['Live']);
    expect(anonymous.totalDocs).toBe(1);

    // A direct Local API call is trusted and sees everything.
    const trusted = await runtime.find({ collection: 'drafted' });
    expect(trusted.docs).toHaveLength(2);
  });
});
