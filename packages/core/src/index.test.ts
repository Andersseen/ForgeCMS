import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, type CollectionData } from './index';

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
