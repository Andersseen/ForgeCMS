import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, slugify, type CollectionData } from './index';

describe('core schema DSL', () => {
  it('defines a typed collection', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        title: defineField.text({ required: true }),
        views: defineField.number(),
        published: defineField.boolean(),
        publishedAt: defineField.date({ withTime: true }),
        author: defineField.relation({ collection: 'users' })
      }
    });

    const example: CollectionData<typeof posts> = {
      title: 'Hello ForgeCMS',
      views: 1,
      published: true,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      author: 'user-1'
    };

    expect(posts.slug).toBe('posts');
    expect(posts.fields.title.kind).toBe('text');
    expect(example.title).toBe('Hello ForgeCMS');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Signature HydraGlow Facial')).toBe('signature-hydraglow-facial');
  });

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Láser & Piel')).toBe('laser-piel');
    expect(slugify('Cañón')).toBe('canon');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(slugify('  ¿Qué es el peeling? — guía  ')).toBe('que-es-el-peeling-guia');
  });

  it('returns an empty string when there is nothing sluggable', () => {
    expect(slugify('###')).toBe('');
  });

  it('leaves an already-valid slug untouched', () => {
    expect(slugify('laser-hair-removal')).toBe('laser-hair-removal');
  });
});
