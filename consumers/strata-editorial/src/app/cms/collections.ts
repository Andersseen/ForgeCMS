import '@strata-sc/server-components/server-only';

import { defineCollection, defineField } from '@forge-cms/core';
import type { CmsUser } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

/**
 * The editorial content model. ForgeCMS owns it entirely: the fields, the draft lifecycle and every
 * access rule below are enforced by the ForgeCMS Local API, never re-implemented in a Strata controller
 * or a Server Component.
 *
 * Access policy (the security contract the qualification asserts):
 *   - anonymous   → published posts only (ForgeCMS's own draft read policy);
 *   - editor      → published posts + their OWN drafts; may change only their own posts;
 *   - admin       → everything;
 *   - viewer      → published posts only, no writes.
 */
export const users = defineUsersCollection();

const isEditor = (user: CmsUser | null | undefined) => user?.role === 'editor';
const isAdmin = (user: CmsUser | null | undefined) => user?.role === 'admin';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      autoGenerate: true,
      sourceField: 'title'
    }),
    summary: defineField.text(),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: ({ user }) => {
      if (!user || isAdmin(user)) return true;
      if (isEditor(user)) {
        return { or: [{ _status: { eq: 'published' } }, { author: { eq: user.id } }] };
      }
      return { _status: { eq: 'published' } };
    },
    create: ({ user }) => isAdmin(user) || isEditor(user),
    update: ({ user }) => {
      if (isAdmin(user)) return true;
      if (isEditor(user) && user) return { author: { eq: user.id } };
      return false;
    },
    delete: ({ user }) => isAdmin(user)
  }
});

export const collections = [users, posts];
