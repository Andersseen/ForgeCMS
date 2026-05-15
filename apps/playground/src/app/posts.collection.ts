import { defineCollection, defineField } from '@devflare-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ label: 'Title', required: true }),
    excerpt: defineField.text({ label: 'Excerpt' }),
    views: defineField.number({ label: 'Views' }),
    published: defineField.boolean({ label: 'Published' }),
    publishedAt: defineField.date({ label: 'Published at', withTime: true }),
    author: defineField.relation({ label: 'Author', collection: 'users' })
  }
});

export const postFields = Object.entries(posts.fields).map(([name, field]) => ({
  name,
  kind: field.kind
}));
