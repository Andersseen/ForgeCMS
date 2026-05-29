import { defineCollection, defineField } from '@forge-cms/core';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';

async function createRuntime(): Promise<ForgeCmsRuntime> {
  const pages = defineCollection({
    slug: 'pages',
    fields: {
      title: defineField.text({ required: true }),
      slug: defineField.slug({ required: true }),
      content: defineField.textarea(),
      status: defineField.select({ options: ['draft', 'published'] }),
      seo: defineField.json(),
      meta: defineField.json()
    }
  });

  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      slug: defineField.slug({ required: true }),
      excerpt: defineField.textarea(),
      body: defineField.textarea(),
      tags: defineField.relation({ collection: 'tags', many: true }),
      category: defineField.text(),
      publishedAt: defineField.date(),
      author: defineField.relation({ collection: 'users' })
    }
  });

  const products = defineCollection({
    slug: 'products',
    fields: {
      sku: defineField.text({ required: true }),
      name: defineField.text({ required: true }),
      description: defineField.textarea(),
      price: defineField.number(),
      inventory: defineField.number(),
      images: defineField.relation({ collection: 'media', many: true }),
      category: defineField.text()
    }
  });

  const media = defineCollection({
    slug: 'media',
    fields: {
      filename: defineField.text({ required: true }),
      alt: defineField.text(),
      mimeType: defineField.text(),
      size: defineField.number(),
      dimensions: defineField.text(),
      url: defineField.text()
    }
  });

  const users = defineCollection({
    slug: 'users',
    fields: {
      email: defineField.email({ required: true }),
      name: defineField.text(),
      role: defineField.select({ options: ['admin', 'editor', 'viewer'] }),
      avatar: defineField.text(),
      status: defineField.select({ options: ['active', 'inactive'] }),
      lastLogin: defineField.date()
    }
  });

  const categories = defineCollection({
    slug: 'categories',
    fields: {
      slug: defineField.slug({ required: true }),
      name: defineField.text({ required: true }),
      description: defineField.textarea(),
      parent: defineField.relation({ collection: 'categories' }),
      order: defineField.number()
    }
  });

  const forms = defineCollection({
    slug: 'forms',
    fields: {
      name: defineField.text({ required: true }),
      fields: defineField.json(),
      submissions: defineField.number(),
      webhook: defineField.text(),
      notifications: defineField.boolean()
    }
  });

  const navigation = defineCollection({
    slug: 'navigation',
    fields: {
      name: defineField.text({ required: true }),
      items: defineField.json(),
      location: defineField.text(),
      locale: defineField.text()
    }
  });

  const runtime = new ForgeCmsRuntime({
    collections: [pages, posts, products, media, users, categories, forms, navigation],
    adapters: {
      database: new LibSqlDatabaseAdapter('file:./.data/forge-cms.db'),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });

  runtime.init();
  await runtime.syncSchema();
  await seedData(runtime);

  return runtime;
}

async function seedData(runtime: ForgeCmsRuntime) {
  const db = runtime.adapters.database;

  // Check if already seeded
  const existing = await db.findMany({ collection: 'pages' });
  if (existing.length > 0) return;

  await db.create('pages', {
    title: 'Home',
    slug: 'home',
    content: 'Welcome to ForgeCMS',
    status: 'published',
    seo: '{}',
    meta: '{}'
  });

  await db.create('pages', {
    title: 'About',
    slug: 'about',
    content: 'About us page',
    status: 'published',
    seo: '{}',
    meta: '{}'
  });

  await db.create('pages', {
    title: 'Contact',
    slug: 'contact',
    content: 'Contact page',
    status: 'draft',
    seo: '{}',
    meta: '{}'
  });

  await db.create('posts', {
    title: 'Getting Started with ForgeCMS',
    slug: 'getting-started',
    excerpt: 'Learn how to build with ForgeCMS',
    body: 'Full article content here...',
    tags: ['cms', 'angular'],
    category: 'tutorial',
    publishedAt: new Date().toISOString(),
    author: 'admin'
  });

  await db.create('products', {
    sku: 'PROD-001',
    name: 'ForgeCMS Pro',
    description: 'Professional CMS license',
    price: 99,
    inventory: 100,
    images: [],
    category: 'software'
  });
}

export const serverRuntimePromise = createRuntime();
