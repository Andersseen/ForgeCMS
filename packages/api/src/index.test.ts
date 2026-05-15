import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@devflare-cms/core';
import { defineCrudHandlers } from './index';

describe('API helpers', () => {
  it('keeps CRUD handlers declarative for now', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        title: defineField.text()
      }
    });

    const handlers = defineCrudHandlers({ collection: posts });

    expect(handlers.collection.slug).toBe('posts');
    expect(handlers.handlers).toEqual({});
  });
});
