export const features = [
  {
    title: 'Typed schema DSL',
    description: 'Start with collections and fields that feel native to TypeScript.'
  },
  {
    title: 'Adapter-first core',
    description: 'Keep database, auth, storage, and API contracts separate from the CMS kernel.'
  },
  {
    title: 'Angular-native future',
    description: 'Build toward an admin and developer experience made for Angular teams.'
  }
] as const;

export const packages = ['core', 'db', 'auth', 'storage', 'api', 'admin', 'testing'] as const;

export const exampleCode = `import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    views: defineField.number(),
    published: defineField.boolean(),
    author: defineField.relation({ collection: 'users' })
  }
});`;
