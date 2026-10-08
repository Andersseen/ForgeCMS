import { defineCollection, defineField } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

/**
 * The whole content model for this readiness fixture (spec 055): users + posts (+ one small `media` upload collection, spec 083), one relation
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

/**
 * Portable files (spec 083, roadmap 0.10 P02): the one upload-enabled collection, kept to the minimum
 * that proves the durable-file journey. `visibility` is the whole access model — staff read every row,
 * everyone else only `public` ones — so `handleFile` has both a public and a protected file to serve.
 * Writes are staff-only.
 */
const isStaff = (user: { role?: string } | null) =>
  user?.role === 'admin' || user?.role === 'editor';

export const media = defineCollection({
  slug: 'media',
  upload: true,
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'contentType', 'visibility']
  },
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text({ required: true }),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text(),
    visibility: defineField.select({ options: ['public', 'private'], defaultValue: 'public' })
  },
  access: {
    read: ({ user }) => (isStaff(user) ? true : { visibility: { eq: 'public' } }),
    create: ({ user }) => isStaff(user),
    update: ({ user }) => isStaff(user),
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, posts, media];
