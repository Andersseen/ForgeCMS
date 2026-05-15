import { defineCollection, defineField } from '@devflare-cms/core';

export function createTestCollection(slug = 'test-posts') {
  return defineCollection({
    slug,
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean()
    }
  });
}

export function createTestRequest(url = 'https://devflare.test'): Request {
  return new Request(url);
}
