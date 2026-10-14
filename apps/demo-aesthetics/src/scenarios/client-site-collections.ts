import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';

const LOCALES = ['es', 'en'];
const isEditor = ({ user }: { user?: { role?: string } | null }): boolean =>
  user?.role === 'admin' || user?.role === 'editor';
const isAdmin = ({ user }: { user?: { role?: string } | null }): boolean => user?.role === 'admin';
const editorial = { read: () => true, create: isEditor, update: isEditor, delete: isAdmin };

/** Users stay admin-managed: editors write content, only admins manage people. */
export const users = defineUsersCollection();

/** Shared by every language: one file, localized alt text lives next to the picture that uses it. */
export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number()
  },
  access: editorial
});

/** Site-wide copy: one document, a locale map per localized field. */
export const siteSettings = defineGlobal({
  slug: 'siteSettings',
  locales: LOCALES,
  fields: {
    siteName: defineField.text({ required: true, localized: true }),
    tagline: defineField.text({ localized: true }),
    footerText: defineField.textarea({ localized: true }),
    logo: defineField.upload({ collection: 'media' })
  },
  access: { read: () => true, update: isEditor }
});

export const pages = defineCollection({
  slug: 'pages',
  drafts: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    description: defineField.textarea({ localized: true }),
    seoTitle: defineField.text({ localized: true }),
    seoDescription: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    hero: defineField.upload({ collection: 'media' })
  },
  access: editorial
});

export const services = defineCollection({
  slug: 'services',
  drafts: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'order'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    description: defineField.textarea({ localized: true }),
    seoTitle: defineField.text({ localized: true }),
    seoDescription: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    image: defineField.upload({ collection: 'media' }),
    imageAlt: defineField.text({ localized: true }),
    order: defineField.number()
  },
  access: editorial
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  versions: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'publishedAt'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    excerpt: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    publishedAt: defineField.date({ withTime: true }),
    cover: defineField.upload({ collection: 'media' })
  },
  access: editorial
});

export const collections = [users, media, pages, services, posts];
export const globals = [siteSettings];
