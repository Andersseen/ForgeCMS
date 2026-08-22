import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import { unflattenCatalog } from './catalog-utils.js';

export interface ExportOptions {
  fallback?: 'none' | 'source';
}

export async function exportTranslationCatalog(
  runtime: ForgeCmsRuntime,
  projectSlug: string,
  locale: string,
  options?: ExportOptions
): Promise<Record<string, unknown>> {
  const fallback = options?.fallback ?? 'none';

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
  const sourceLocale = project.sourceLocale as string;

  if (!projectLocales.includes(locale)) {
    throw new Error(
      `Locale '${locale}' is not configured for project '${projectSlug}'. Available: ${projectLocales.join(', ')}`
    );
  }

  const messages = await runtime.find({
    collection: 'translation_messages',
    where: { project: projectId },
    limit: 10000
  });

  const flatMessages: Record<string, string> = {};

  for (const msg of messages.docs) {
    const key = msg.key as string;
    const translations = (msg.translations as Record<string, string>) ?? {};

    let value = translations[locale];

    if (value === undefined && fallback === 'source' && locale !== sourceLocale) {
      value = translations[sourceLocale];
    }

    if (value !== undefined) {
      flatMessages[key] = value;
    }
  }

  return unflattenCatalog(flatMessages);
}
