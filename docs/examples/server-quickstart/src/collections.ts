import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';

// The users collection owned by the auth adapter: email, name, role, password hash.
export const users = defineUsersCollection();

export const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    body: defineField.textarea(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, notes];
