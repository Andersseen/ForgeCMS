import { defineCollection, defineField } from '@forge-cms/core';

export function createTestCollection(slug = 'test-posts') {
  return defineCollection({
    slug,
    fields: {
      title: defineField.text({ required: true }),
      published: defineField.boolean()
    }
  });
}

export function createTestRequest(url = 'https://forge.test'): Request {
  return new Request(url);
}
