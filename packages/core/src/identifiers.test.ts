import { describe, expect, it } from 'vitest';
import { validateCollectionIdentifiers } from './identifiers.js';
import { defineField } from './index.js';

describe('validateCollectionIdentifiers', () => {
  it('accepts a normal collection', () => {
    const errors = validateCollectionIdentifiers({
      slug: 'posts',
      fields: { title: defineField.text() }
    });
    expect(errors).toEqual([]);
  });

  it('rejects a field named after a system field', () => {
    const errors = validateCollectionIdentifiers({
      slug: 'posts',
      fields: { created_at: defineField.text() }
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('system field');
  });

  it.each(['and', 'or'])(
    'rejects a field literally named "%s" — reserved for nested where queries (spec 050)',
    (name) => {
      const errors = validateCollectionIdentifiers({
        slug: 'posts',
        fields: { [name]: defineField.text() }
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('reserved query keyword');
    }
  );

  it('still allows a field name that only contains "and"/"or" as a substring', () => {
    const errors = validateCollectionIdentifiers({
      slug: 'posts',
      fields: {
        brand: defineField.text(),
        author: defineField.text(),
        orders: defineField.number()
      }
    });
    expect(errors).toEqual([]);
  });
});
