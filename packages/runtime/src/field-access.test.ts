import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { filterReadableFields, assertWritableFields, FieldAccessError } from './field-access.js';

const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text(),
    internalNote: defineField.text({ access: { read: ['admin'], write: ['admin'] } })
  }
});

describe('filterReadableFields', () => {
  it('keeps unrestricted fields regardless of role', () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    expect(filterReadableFields(record, posts, undefined).title).toBe('Hello');
    expect(filterReadableFields(record, posts, 'viewer').title).toBe('Hello');
  });

  it('omits a restricted field for an unauthorized role', () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = filterReadableFields(record, posts, 'viewer');
    expect(filtered).not.toHaveProperty('internalNote');
  });

  it('omits a restricted field for unauthenticated (undefined role)', () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = filterReadableFields(record, posts, undefined);
    expect(filtered).not.toHaveProperty('internalNote');
  });

  it('keeps a restricted field for an authorized role', () => {
    const record = { id: '1', title: 'Hello', internalNote: 'secret' };
    const filtered = filterReadableFields(record, posts, 'admin');
    expect(filtered.internalNote).toBe('secret');
  });

  it('leaves non-schema keys (e.g. id, populated relations) untouched', () => {
    const record = { id: '1', title: 'Hello' };
    expect(filterReadableFields(record, posts, 'viewer').id).toBe('1');
  });
});

describe('assertWritableFields', () => {
  it('allows unrestricted fields regardless of role', () => {
    expect(() => assertWritableFields({ title: 'Hello' }, posts, undefined)).not.toThrow();
  });

  it('throws FieldAccessError for a restricted field set by an unauthorized role', () => {
    expect(() => assertWritableFields({ internalNote: 'x' }, posts, 'viewer')).toThrow(
      FieldAccessError
    );
    expect(() => assertWritableFields({ internalNote: 'x' }, posts, 'viewer')).toThrow(
      "cannot set field 'internalNote'"
    );
  });

  it('throws for unauthenticated (undefined role)', () => {
    expect(() => assertWritableFields({ internalNote: 'x' }, posts, undefined)).toThrow(
      FieldAccessError
    );
  });

  it('allows a restricted field set by an authorized role', () => {
    expect(() => assertWritableFields({ internalNote: 'x' }, posts, 'admin')).not.toThrow();
  });
});
