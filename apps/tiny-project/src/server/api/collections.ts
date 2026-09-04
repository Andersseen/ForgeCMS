import { defineCollection, defineField } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

/**
 * The whole content model for this readiness fixture (spec 055): users + posts, one relation
 * (`post.author -> users`), drafts, and role-gated writes — deliberately nothing more. Every
 * primitive here is a public `@forge-cms/*` export; nothing is copied from an internal collection.
 */
export const users = defineUsersCollection();

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author']
  },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      autoGenerate: true,
      sourceField: 'title'
    }),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, posts];
