import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import { flattenCatalog, validateTranslationKey } from './catalog-utils.js';

export interface ImportError {
  key: string;
  reason: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  total: number;
  errors: ImportError[];
}

const MAX_CATALOG_SIZE = 2 * 1024 * 1024;

export async function importTranslationCatalog(
  runtime: ForgeCmsRuntime,
  projectSlug: string,
  locale: string,
  catalog: Record<string, unknown>
): Promise<ImportResult> {
  const catalogJson = JSON.stringify(catalog);
  if (catalogJson.length > MAX_CATALOG_SIZE) {
    throw new Error(
      `Catalog size (${catalogJson.length} bytes) exceeds maximum allowed size (${MAX_CATALOG_SIZE} bytes)`
    );
  }

  const projectDocs = await runtime.find({
    collection: 'translation_projects',
    where: { slug: projectSlug }
  });

  if (projectDocs.docs.length === 0) {
    throw new Error(`Translation project '${projectSlug}' not found`);
  }

  const project = projectDocs.docs[0]!;
  const projectId = project.id as string;
  const projectLocales = project.locales as string[];

  if (!projectLocales.includes(locale)) {
    throw new Error(
      `Locale '${locale}' is not configured for project '${projectSlug}'. Available: ${projectLocales.join(', ')}`
    );
  }

  const flattened = flattenCatalog(catalog);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    total: 0,
    errors: flattened.errors.map((e) => ({ key: e.key, reason: e.reason }))
  };

  const existingMessages = await runtime.find({
    collection: 'translation_messages',
    where: { project: projectId },
    limit: 10000
  });

  const messageByKey = new Map<string, Record<string, unknown>>();
  for (const msg of existingMessages.docs) {
    const key = msg.key as string;
    messageByKey.set(key, msg);
  }

  for (const [key, value] of flattened.entries) {
    result.total++;

    const keyValidation = validateTranslationKey(key);
    if (!keyValidation.valid) {
      result.errors.push({ key, reason: keyValidation.error! });
      continue;
    }

    const existing = messageByKey.get(key);

    if (!existing) {
      const translations: Record<string, string> = { [locale]: value };
      await runtime.create({
        collection: 'translation_messages',
        data: {
          project: projectId,
          key,
          translations
        }
      });
      result.created++;
    } else {
      const existingTranslations =
        (existing.translations as Record<string, string>) ?? {};

      if (existingTranslations[locale] === value) {
        result.unchanged++;
        continue;
      }

      const updatedTranslations = { ...existingTranslations, [locale]: value };
      await runtime.update({
        collection: 'translation_messages',
        id: existing.id as string,
        data: { translations: updatedTranslations }
      });
      result.updated++;
    }
  }

  return result;
}
