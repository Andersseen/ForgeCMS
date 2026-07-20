import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';

export interface ServerEnv {
  DB?: D1Database;
  AUTH_SECRET?: string;
}

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

const siteConfig = defineCollection({
  slug: 'site_config',
  fields: {
    siteName: defineField.text({ required: true }),
    description: defineField.textarea(),
    defaultLanguage: defineField.text(),
    timezone: defineField.text(),
    fromAddress: defineField.email(),
    newUserNotifications: defineField.boolean(),
    contentAlerts: defineField.boolean()
  }
});

const collections = [
  pages,
  posts,
  products,
  media,
  users,
  categories,
  forms,
  navigation,
  siteConfig
];

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

/**
 * Lazily builds (and seeds) the runtime on first call. Must only be invoked from within a request
 * handler — Cloudflare Workers forbids async I/O (including crypto.randomUUID) at module/global
 * scope, so both adapter construction and seeding must wait for a real request instead of running
 * eagerly at module load time.
 */
export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(env);
  }
  return runtimePromise;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: {
      database,
      auth,
      storage: new InMemoryStorageAdapter()
    },
    ...(env !== undefined && { env })
  });

  runtime.init();
  await runtime.syncSchema();
  await seedIfEmpty(runtime);

  return runtime;
}

async function seedIfEmpty(runtime: ForgeCmsRuntime): Promise<void> {
  const db = runtime.adapters.database;
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  // site_config is seeded with exactly one record and nothing else creates one, so it's a safe,
  // cheap sentinel for "has this database already been seeded" — D1 persists across cold starts,
  // so seeding must not run more than once against the same database.
  const existing = await db.findMany({ collection: 'site_config', limit: 1 });
  if (existing.length > 0) return;

  // Seed the demo admin user so the published login credentials keep working.
  await auth.createUser({
    email: 'demo@forgecms.dev',
    password: 'forgecms-demo',
    name: 'Demo Admin',
    role: 'admin'
  });

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

  await db.create('site_config', {
    siteName: 'ForgeCMS Demo',
    description: 'An experimental CMS foundation for Angular and Analog.js',
    defaultLanguage: 'en-US',
    timezone: 'UTC',
    fromAddress: 'noreply@forgecms.dev',
    newUserNotifications: false,
    contentAlerts: false
  });
}
