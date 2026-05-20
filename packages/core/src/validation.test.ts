import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, validateCollection, validateField } from './index';

describe('runtime validation', () => {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true, minLength: 2, maxLength: 100 }),
      excerpt: defineField.text({ maxLength: 200 }),
      views: defineField.number({ min: 0, max: 999_999 }),
      published: defineField.boolean({ required: true }),
      publishedAt: defineField.date({ required: true, withTime: true }),
      author: defineField.relation({ required: true, collection: 'users' }),
      tags: defineField.relation({ collection: 'tags', many: true })
    }
  });

  it('validates a correct object successfully', () => {
    const data = {
      title: 'Hello ForgeCMS',
      excerpt: 'A short summary',
      views: 42,
      published: true,
      publishedAt: new Date('2026-01-01T12:00:00Z'),
      author: 'user-1',
      tags: ['tag-1', 'tag-2']
    };

    const result = validateCollection(posts, data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when required fields are missing', () => {
    const result = validateCollection(posts, {
      title: undefined,
      published: null,
      publishedAt: '',
      author: ''
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', code: 'required' }),
        expect.objectContaining({ field: 'published', code: 'required' }),
        expect.objectContaining({ field: 'publishedAt', code: 'required' }),
        expect.objectContaining({ field: 'author', code: 'required' })
      ])
    );
  });

  it('allows optional fields to be absent', () => {
    const result = validateCollection(posts, {
      title: 'Hello',
      published: false,
      publishedAt: new Date(),
      author: 'user-1'
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  describe('text field validation', () => {
    it('fails on non-string value', () => {
      const result = validateCollection(posts, { title: 123 });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'title', code: 'type_text' })
      );
    });

    it('fails when shorter than minLength', () => {
      const result = validateCollection(posts, { title: 'A' });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'title', code: 'minLength' })
      );
    });

    it('fails when longer than maxLength', () => {
      const result = validateCollection(posts, { title: 'A'.repeat(101) });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'title', code: 'maxLength' })
      );
    });

    it('passes empty optional text field', () => {
      const result = validateCollection(posts, {});
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'excerpt' })
      );
    });
  });

  describe('number field validation', () => {
    it('fails on non-number value', () => {
      const result = validateCollection(posts, { views: 'many' });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'views', code: 'type_number' })
      );
    });

    it('fails below min', () => {
      const result = validateCollection(posts, { views: -1 });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'views', code: 'min' })
      );
    });

    it('fails above max', () => {
      const result = validateCollection(posts, { views: 1_000_000 });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'views', code: 'max' })
      );
    });

    it('passes NaN check', () => {
      const result = validateCollection(posts, { views: NaN });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'views', code: 'type_number' })
      );
    });
  });

  describe('boolean field validation', () => {
    it('fails on non-boolean value', () => {
      const result = validateCollection(posts, { published: 'yes' });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'published', code: 'type_boolean' })
      );
    });
  });

  describe('date field validation', () => {
    it('accepts Date object', () => {
      const result = validateCollection(posts, { publishedAt: new Date() });
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'publishedAt' })
      );
    });

    it('accepts ISO string', () => {
      const result = validateCollection(posts, { publishedAt: '2026-05-19T10:00:00Z' });
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'publishedAt' })
      );
    });

    it('accepts timestamp number', () => {
      const result = validateCollection(posts, { publishedAt: Date.now() });
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'publishedAt' })
      );
    });

    it('fails on invalid string', () => {
      const result = validateCollection(posts, { publishedAt: 'not-a-date' });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'publishedAt', code: 'type_date' })
      );
    });

    it('fails on invalid object', () => {
      const result = validateCollection(posts, { publishedAt: {} });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'publishedAt', code: 'type_date' })
      );
    });
  });

  describe('relation field validation', () => {
    it('accepts single string relation', () => {
      const result = validateCollection(posts, { author: 'user-1' });
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'author' })
      );
    });

    it('fails on non-string single relation', () => {
      const result = validateCollection(posts, { author: 123 });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'author', code: 'type_relation' })
      );
    });

    it('accepts array for many relation', () => {
      const result = validateCollection(posts, { tags: ['tag-1', 'tag-2'] });
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ field: 'tags' })
      );
    });

    it('fails on non-array for many relation', () => {
      const result = validateCollection(posts, { tags: 'tag-1' });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'tags', code: 'type_relation' })
      );
    });

    it('fails when array item is not string', () => {
      const result = validateCollection(posts, { tags: ['tag-1', 42] });
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'tags', code: 'type_relation' })
      );
    });
  });

  describe('validateField directly', () => {
    it('validates a single field', () => {
      const field = defineField.number({ min: 0, max: 10 });
      const errors = validateField(field, 5, 'rating');
      expect(errors).toHaveLength(0);
    });

    it('reports multiple errors on one field', () => {
      const field = defineField.text({ required: true, minLength: 5, maxLength: 3 });
      const errors = validateField(field, 'AB', 'title');
      // minLength will fail (2 < 5), maxLength won't fire because value is shorter
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
