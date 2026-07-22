import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CmsUser } from '@forge-cms/core';
import { filterReadableFields, assertWritableFields, FieldAccessError } from './field-access.js';

const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text(),
    internalNote: defineField.text({ access: { read: ['admin'], write: ['admin'] } })
  }
});

/** Field access resolves against a user now (spec 020), not a bare role string. */
const asRole = (role: string): CmsUser => ({ id: 'u1', role });
const anonymous = null;

describe('filterReadableFields', () => {
  it('keeps unrestricted fields regardless of role', async () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    expect((await filterReadableFields(record, posts, anonymous)).title).toBe('Hello');
    expect((await filterReadableFields(record, posts, asRole('viewer'))).title).toBe('Hello');
  });

  it('omits a restricted field for an unauthorized role', async () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = await filterReadableFields(record, posts, asRole('viewer'));
    expect(filtered).not.toHaveProperty('internalNote');
  });

  it('omits a restricted field for unauthenticated users', async () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = await filterReadableFields(record, posts, anonymous);
    expect(filtered).not.toHaveProperty('internalNote');
  });

  it('keeps a restricted field for an authorized role', async () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = await filterReadableFields(record, posts, asRole('admin'));
    expect(filtered.internalNote).toBe('secret');
  });

  it('leaves non-schema keys (e.g. id, populated relations) untouched', async () => {
    const record = { id: '1', title: 'Hello' };
    expect((await filterReadableFields(record, posts, asRole('viewer'))).id).toBe('1');
  });

  it('supports a predicate rule that inspects the document', async () => {
    const orders = defineCollection({
      slug: 'orders',
      fields: {
        ownerId: defineField.text(),
        total: defineField.number({
          access: { read: ({ user, doc }) => doc?.ownerId === user?.id }
        })
      }
    });

    const record = { id: 'o1', ownerId: 'u1', total: 42 };
    expect(await filterReadableFields(record, orders, { id: 'u1' })).toHaveProperty('total', 42);
    expect(await filterReadableFields(record, orders, { id: 'u2' })).not.toHaveProperty('total');
  });
});

describe('assertWritableFields', () => {
  it('allows unrestricted fields regardless of role', async () => {
    await expect(
      assertWritableFields({ title: 'Hello' }, posts, anonymous)
    ).resolves.toBeUndefined();
  });

  it('rejects a restricted field set by an unauthorized role', async () => {
    await expect(
      assertWritableFields({ internalNote: 'x' }, posts, asRole('viewer'))
    ).rejects.toThrow(FieldAccessError);
    await expect(
      assertWritableFields({ internalNote: 'x' }, posts, asRole('viewer'))
    ).rejects.toThrow("cannot set field 'internalNote'");
  });

  it('rejects for unauthenticated users', async () => {
    await expect(assertWritableFields({ internalNote: 'x' }, posts, anonymous)).rejects.toThrow(
      FieldAccessError
    );
  });

  it('allows a restricted field set by an authorized role', async () => {
    await expect(
      assertWritableFields({ internalNote: 'x' }, posts, asRole('admin'))
    ).resolves.toBeUndefined();
  });

  it('supports a predicate rule', async () => {
    const posts2 = defineCollection({
      slug: 'posts2',
      fields: {
        pinned: defineField.boolean({ access: { write: ({ user }) => user?.role === 'admin' } })
      }
    });

    await expect(
      assertWritableFields({ pinned: true }, posts2, asRole('admin'))
    ).resolves.toBeUndefined();
    await expect(assertWritableFields({ pinned: true }, posts2, asRole('editor'))).rejects.toThrow(
      FieldAccessError
    );
  });
});
