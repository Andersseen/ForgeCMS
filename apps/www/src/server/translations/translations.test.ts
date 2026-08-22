import { describe, expect, it, beforeEach } from 'vitest';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { importTranslationCatalog } from './import-service.js';
import { exportTranslationCatalog } from './export-service.js';

const translationProjects = defineCollection({
  slug: 'translation_projects',
  fields: {
    name: defineField.text({ label: 'Name', required: true }),
    slug: defineField.slug({
      label: 'Slug',
      sourceField: 'name',
      autoGenerate: true,
      required: true
    }),
    sourceLocale: defineField.text({ label: 'Source locale', required: true }),
    locales: defineField.json({ label: 'Locales', required: true }),
    description: defineField.textarea({ label: 'Description' })
  }
});

const translationMessages = defineCollection({
  slug: 'translation_messages',
  fields: {
    project: defineField.relation({
      label: 'Project',
      collection: 'translation_projects',
      required: true
    }),
    key: defineField.text({ label: 'Key', required: true }),
    translations: defineField.json({ label: 'Translations', required: true }),
    description: defineField.text({ label: 'Description' })
  }
});

function createRuntime(): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections: [translationProjects, translationMessages],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

async function createProject(
  runtime: ForgeCmsRuntime,
  name: string,
  sourceLocale: string,
  locales: string[]
): Promise<Record<string, unknown>> {
  return runtime.create({
    collection: 'translation_projects',
    data: {
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      sourceLocale,
      locales
    }
  });
}

describe('importTranslationCatalog', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(() => {
    runtime = createRuntime();
  });

  it('imports a new catalog creating message records', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es', 'uk']);

    const result = await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      nav: { docs: 'Docs', components: 'Components' },
      footer: { rights: '© {$year}' }
    });

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.total).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('updates existing messages for a new locale without destroying other locales', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es', 'uk']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      nav: { docs: 'Docs' }
    });

    const result = await importTranslationCatalog(runtime, 'volt-ui', 'es', {
      nav: { docs: 'Documentación' }
    });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);

    const messages = await runtime.find({
      collection: 'translation_messages',
      limit: 100
    });

    expect(messages.docs).toHaveLength(1);
    const translations = messages.docs[0]!.translations as Record<string, string>;
    expect(translations['en']).toBe('Docs');
    expect(translations['es']).toBe('Documentación');
  });

  it('counts unchanged messages when importing the same value', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', { hello: 'Hello' });

    const result = await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      hello: 'Hello'
    });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  it('does not silently delete messages absent from a new import', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      nav: { docs: 'Docs', components: 'Components' }
    });

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      nav: { docs: 'Documentation' }
    });

    const messages = await runtime.find({
      collection: 'translation_messages',
      limit: 100
    });

    expect(messages.docs).toHaveLength(2);
  });

  it('rejects import for non-existent project', async () => {
    await expect(
      importTranslationCatalog(runtime, 'non-existent', 'en', { hello: 'Hello' })
    ).rejects.toThrow('not found');
  });

  it('rejects import for locale not in project', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await expect(
      importTranslationCatalog(runtime, 'volt-ui', 'fr', { hello: 'Bonjour' })
    ).rejects.toThrow('not configured');
  });

  it('reports errors for invalid catalog values', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en']);

    const result = await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      valid: 'ok',
      invalid: 42
    });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe('exportTranslationCatalog', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(() => {
    runtime = createRuntime();
  });

  it('exports a catalog with deterministic ordering', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      nav: { docs: 'Docs', components: 'Components' },
      footer: { rights: '© {$year}' }
    });

    const exported = await exportTranslationCatalog(runtime, 'volt-ui', 'en');

    expect(exported).toEqual({
      footer: { rights: '© {$year}' },
      nav: { components: 'Components', docs: 'Docs' }
    });
  });

  it('omits keys with missing values by default', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      hello: 'Hello',
      goodbye: 'Goodbye'
    });

    await importTranslationCatalog(runtime, 'volt-ui', 'es', {
      hello: 'Hola'
    });

    const exported = await exportTranslationCatalog(runtime, 'volt-ui', 'es');

    expect(exported).toEqual({ hello: 'Hola' });
  });

  it('falls back to source locale when fallback is source', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await importTranslationCatalog(runtime, 'volt-ui', 'en', {
      hello: 'Hello',
      goodbye: 'Goodbye'
    });

    await importTranslationCatalog(runtime, 'volt-ui', 'es', {
      hello: 'Hola'
    });

    const exported = await exportTranslationCatalog(runtime, 'volt-ui', 'es', {
      fallback: 'source'
    });

    expect(exported).toEqual({ goodbye: 'Goodbye', hello: 'Hola' });
  });

  it('rejects export for non-existent project', async () => {
    await expect(
      exportTranslationCatalog(runtime, 'non-existent', 'en')
    ).rejects.toThrow('not found');
  });

  it('rejects export for locale not in project', async () => {
    await createProject(runtime, 'Volt UI', 'en', ['en', 'es']);

    await expect(
      exportTranslationCatalog(runtime, 'volt-ui', 'fr')
    ).rejects.toThrow('not configured');
  });

  it('per-project locale isolation: project A and B coexist', async () => {
    await createProject(runtime, 'Project A', 'en', ['en', 'es', 'uk']);
    await createProject(runtime, 'Project B', 'en', ['en', 'fr']);

    await importTranslationCatalog(runtime, 'project-a', 'en', {
      hello: 'Hello A'
    });
    await importTranslationCatalog(runtime, 'project-b', 'en', {
      hello: 'Hello B'
    });

    const exportedA = await exportTranslationCatalog(runtime, 'project-a', 'en');
    const exportedB = await exportTranslationCatalog(runtime, 'project-b', 'en');

    expect(exportedA).toEqual({ hello: 'Hello A' });
    expect(exportedB).toEqual({ hello: 'Hello B' });
  });
});
