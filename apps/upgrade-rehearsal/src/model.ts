import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';
import { defineMigration } from '@forge-cms/db';
import type { MigrationDefinition } from '@forge-cms/db';

/**
 * The representative application as it is declared **today** — the configuration a consumer deploys
 * after upgrading ForgeCMS. The historical fixtures were written by the same application at older
 * releases (`generator/seed.mjs` declares that older shape). Three changes happened in between, each
 * one M01 refuses to apply automatically, so M02's reviewed migrations are exercised for real:
 *
 * 1. `categories.label` was renamed to `name` (a rename is never guessed).
 * 2. `categories.slug` went from `index: true` to `unique: true` (SQLite cannot make an index unique
 *    in place).
 * 3. `media.alt` was added as a required field, backfilled from the filename (rows exist).
 *
 * `posts.summary` (localized) is new for a 0.4.x installation and applies as a safe additive column.
 */
export const users = defineUsersCollection();

export const categories = defineCollection({
  slug: 'categories',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'name', unique: true })
  }
});

export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text(),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text({ required: true })
  }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  versions: true,
  locales: ['en', 'es'],
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title', unique: true }),
    summary: defineField.text({ localized: true }),
    body: defineField.richtext(),
    seo: defineField.group({ fields: { description: defineField.text() } }),
    meta: defineField.json(),
    category: defineField.relation({ collection: 'categories', onDelete: 'restrict' }),
    tags: defineField.relation({ collection: 'categories', many: true }),
    author: defineField.relation({ collection: 'users' }),
    hero: defineField.upload({ collection: 'media' })
  }
});

export const settings = defineGlobal({
  slug: 'settings',
  fields: { siteName: defineField.text(), tagline: defineField.text() }
});

export const collections: CollectionDefinition[] = [users, categories, media, posts];
export const globals: GlobalDefinition[] = [settings];

/**
 * The application's reviewed migration history — append-only, exactly what a consumer keeps in
 * `migrations.ts` and runs from its deploy script with `runtime.runMigrations()`.
 */
export const migrations: MigrationDefinition[] = [
  defineMigration({
    id: '20260929_001_categories_label_to_name',
    description: 'Rename categories.label to name',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "categories" RENAME COLUMN "label" TO "name"' }],
    resetBaseline: ['categories']
  }),
  defineMigration({
    id: '20260929_002_categories_slug_unique',
    description: 'Drop the non-unique slug index so the post-flight sync can create the unique one',
    destructive: true,
    statements: [{ sql: 'DROP INDEX IF EXISTS "idx_categories_slug"' }]
  }),
  defineMigration({
    id: '20260929_003_media_alt_backfill',
    description: 'Add the required media.alt and backfill it from the filename',
    destructive: false,
    statements: [
      { sql: 'ALTER TABLE "media" ADD COLUMN "alt" TEXT' },
      {
        sql: 'UPDATE "media" SET "alt" = COALESCE("filename", ?) WHERE "alt" IS NULL',
        args: ['(untitled)']
      }
    ]
  })
];
