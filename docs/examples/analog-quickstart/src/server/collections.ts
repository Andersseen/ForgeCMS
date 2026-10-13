import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';

export const users = defineUsersCollection();

export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text()
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    body: defineField.richtext(),
    cover: defineField.upload({ collection: 'media' }),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, media, posts];
