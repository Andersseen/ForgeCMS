import { describe, expect, it, beforeEach } from 'vitest';
import { defineField, defineCollection } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import {
  resolveLocale,
  getLocalizedValue,
  setLocalizedValue,
  resolveLocalizedDocument,
  storeLocalizedDocument
} from './localization.js';

describe('Localization utilities', () => {
  describe('resolveLocale', () => {
    it('returns default locale when no locale requested', () => {
      expect(resolveLocale(undefined, ['en', 'es'])).toBe('en');
    });

    it('returns exact match', () => {
      expect(resolveLocale('es', ['en', 'es', 'fr'])).toBe('es');
    });

    it('falls back to language from region', () => {
      expect(resolveLocale('es-MX', ['en', 'es'])).toBe('es');
    });

    it('falls back to default when locale not available', () => {
      expect(resolveLocale('de', ['en', 'es'])).toBe('en');
    });
  });

  describe('getLocalizedValue', () => {
    it('returns value for exact locale', () => {
      const value = { en: 'Hello', es: 'Hola' };
      expect(getLocalizedValue(value, 'es', ['en', 'es'])).toBe('Hola');
    });

    it('falls back to language from region', () => {
      const value = { en: 'Hello', es: 'Hola' };
      expect(getLocalizedValue(value, 'es-MX', ['en', 'es'])).toBe('Hola');
    });

    it('falls back to default locale', () => {
      const value = { en: 'Hello', es: 'Hola' };
      expect(getLocalizedValue(value, 'de', ['en', 'es'])).toBe('Hello');
    });

    it('returns non-object values unchanged', () => {
      expect(getLocalizedValue('plain', 'en', ['en'])).toBe('plain');
    });
  });

  describe('setLocalizedValue', () => {
    it('sets value for locale', () => {
      const result = setLocalizedValue({}, 'en', 'Hello');
      expect(result).toEqual({ en: 'Hello' });
    });

    it('preserves other locales', () => {
      const result = setLocalizedValue({ en: 'Hello' }, 'es', 'Hola');
      expect(result).toEqual({ en: 'Hello', es: 'Hola' });
    });

    it('overwrites existing locale', () => {
      const result = setLocalizedValue({ en: 'Hello' }, 'en', 'Hi');
      expect(result).toEqual({ en: 'Hi' });
    });
  });

  describe('resolveLocalizedDocument', () => {
    it('resolves localized fields to requested locale', () => {
      const collection = defineCollection({
        slug: 'posts',
        locales: ['en', 'es'],
        fields: {
          title: defineField.text({ localized: true }),
          slug: defineField.slug()
        }
      });

      const doc = {
        id: '1',
        title: { en: 'Hello', es: 'Hola' },
        slug: 'hello'
      };

      const resolved = resolveLocalizedDocument(doc, collection, 'es');
      expect(resolved.title).toBe('Hola');
      expect(resolved.slug).toBe('hello');
    });

    it('returns document unchanged when no locale specified', () => {
      const collection = defineCollection({
        slug: 'posts',
        locales: ['en', 'es'],
        fields: {
          title: defineField.text({ localized: true })
        }
      });

      const doc = { id: '1', title: { en: 'Hello', es: 'Hola' } };
      const resolved = resolveLocalizedDocument(doc, collection, undefined);
      expect(resolved).toEqual(doc);
    });
  });

  describe('storeLocalizedDocument', () => {
    it('stores value in specified locale', () => {
      const collection = defineCollection({
        slug: 'posts',
        locales: ['en', 'es'],
        fields: {
          title: defineField.text({ localized: true })
        }
      });

      const data = { title: 'Hola' };
      const stored = storeLocalizedDocument(data, collection, 'es');
      expect(stored.title).toEqual({ es: 'Hola' });
    });

    it('merges with existing localized values', () => {
      const collection = defineCollection({
        slug: 'posts',
        locales: ['en', 'es'],
        fields: {
          title: defineField.text({ localized: true })
        }
      });

      const existing = { title: { en: 'Hello' } };
      const data = { title: 'Hola' };
      const stored = storeLocalizedDocument(data, collection, 'es', existing);
      expect(stored.title).toEqual({ en: 'Hello', es: 'Hola' });
    });
  });
});

describe('Localization integration', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    const posts = defineCollection({
      slug: 'posts',
      locales: ['en', 'es'],
      fields: {
        title: defineField.text({ required: true, localized: true }),
        slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
        body: defineField.text()
      }
    });

    const auth = new InMemoryAuthAdapter();
    auth.registerSession('test-token', {
      user: { id: 'user-1', email: 'test@example.com', roles: ['admin'] }
    });

    runtime = new ForgeCmsRuntime({
      collections: [posts],
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth,
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();
  });

  it('creates a document with localized field in specified locale', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello' },
      locale: 'en'
    });

    // When reading with locale='en', the title is resolved to English
    expect(doc.title).toBe('Hello');

    // Fetch without locale to see the full localized object
    const raw = await runtime.findByID({
      collection: 'posts',
      id: doc.id as string
    });
    expect(raw.title).toEqual({ en: 'Hello' });
  });

  it('updates a localized field in a different locale', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello' },
      locale: 'en'
    });

    const updated = await runtime.update({
      collection: 'posts',
      id: doc.id as string,
      data: { title: 'Hola' },
      locale: 'es'
    });

    // When reading with locale='es', the title is resolved to Spanish
    expect(updated.title).toBe('Hola');

    // Fetch without locale to see the full localized object
    const raw = await runtime.findByID({
      collection: 'posts',
      id: doc.id as string
    });
    expect(raw.title).toEqual({ en: 'Hello', es: 'Hola' });
  });

  it('reads a document with localized fields resolved to requested locale', async () => {
    await runtime.create({
      collection: 'posts',
      data: { title: 'Hello' },
      locale: 'en'
    });

    await runtime.update({
      collection: 'posts',
      id: (await runtime.find({ collection: 'posts' })).docs[0]!.id as string,
      data: { title: 'Hola' },
      locale: 'es'
    });

    const docs = await runtime.find({
      collection: 'posts',
      locale: 'es'
    });

    // The title should be resolved to Spanish
    expect(docs.docs[0]!.title).toBe('Hola');
  });

  it('falls back to default locale when requested locale not available', async () => {
    const doc = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello' },
      locale: 'en'
    });

    const found = await runtime.findByID({
      collection: 'posts',
      id: doc.id as string,
      locale: 'fr' // Not available, should fall back to 'en'
    });

    expect(found.title).toBe('Hello');
  });
});
