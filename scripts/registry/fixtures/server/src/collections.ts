import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';

export const users = defineUsersCollection();

const isWriter = ({ user }: { user: { role?: string } | null }) =>
  user?.role === 'admin' || user?.role === 'editor';

export const categories = defineCollection({
  slug: 'categories',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'name' })
  },
  access: {
    read: () => true,
    create: isWriter,
    update: isWriter,
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    body: defineField.textarea(),
    views: defineField.number(),
    category: defineField.relation({ collection: 'categories' }),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: isWriter,
    update: isWriter,
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const siteSettings = defineGlobal({
  slug: 'site_settings',
  fields: {
    siteName: defineField.text({ required: true }),
    tagline: defineField.text()
  },
  access: {
    read: () => true,
    update: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, categories, posts];
export const globals = [siteSettings];
