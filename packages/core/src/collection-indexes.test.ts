import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from './index.js';
import { validateCollectionIndexes } from './collection-indexes.js';

describe('validateCollectionIndexes', () => {
  const fields = {
    project: defineField.text({ required: true }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text()
  };

  it('accepts a collection with no indexes', () => {
    expect(validateCollectionIndexes({ slug: 'catalogs', fields })).toEqual([]);
  });

  it('accepts a valid compound index', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
    });
    expect(errors).toEqual([]);
  });

  it('rejects an index with an empty fields array', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: [] }]
    });
    expect(errors).toEqual([
      'Collection "catalogs" indexes[0] must list at least one field in "fields".'
    ]);
  });

  it('rejects an index referencing an unknown field', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['doesNotExist'] }]
    });
    expect(errors).toEqual([
      'Collection "catalogs" indexes[0] references unknown field "doesNotExist".'
    ]);
  });

  it('rejects an index with a duplicated field', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['project', 'project'] }]
    });
    expect(errors).toEqual([
      'Collection "catalogs" indexes[0] lists field "project" more than once.'
    ]);
  });

  it('rejects two indexes with the exact same field list', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['project', 'locale'] }, { fields: ['project', 'locale'], unique: true }]
    });
    expect(errors).toEqual([
      'Collection "catalogs" declares more than one index on fields (project, locale).'
    ]);
  });

  it('treats field order as significant: [a, b] and [b, a] are different indexes', () => {
    const errors = validateCollectionIndexes({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['project', 'locale'] }, { fields: ['locale', 'project'] }]
    });
    expect(errors).toEqual([]);
  });

  it('throws from defineCollection with an invalid index', () => {
    expect(() =>
      defineCollection({
        slug: 'catalogs',
        fields,
        indexes: [{ fields: [] }]
      })
    ).toThrow('must list at least one field');
  });

  it('defineCollection succeeds with a valid compound unique index', () => {
    const catalogs = defineCollection({
      slug: 'catalogs',
      fields,
      indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
    });
    expect(catalogs.indexes).toEqual([
      { fields: ['project', 'locale', 'namespace'], unique: true }
    ]);
  });
});
