import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MARKETING_PATHS,
  PREFIXED_LOCALES,
  localizePath,
  pageLocales
} from '../src/app/i18n/site-locales.mjs';

/**
 * The public, indexable pages of the website and the locales each one really exists in (spec 101).
 * One function feeds both the prerender list (vite.config.ts) and the sitemap, so a URL is generated
 * exactly when it is advertised: English docs from `src/content/docs/*.md`, a translated article only
 * when `src/content/<locale>/docs/<slug>.md` exists.
 */
export function publicPages(appRoot) {
  const slugsIn = (directory) =>
    existsSync(directory)
      ? readdirSync(directory)
          .filter((filename) => filename.endsWith('.md'))
          .map((filename) => filename.slice(0, -3))
          .sort()
      : [];
  const englishDocs = slugsIn(resolve(appRoot, 'src/content/docs'));
  const translatedDocs = Object.fromEntries(
    PREFIXED_LOCALES.map((locale) => [
      locale,
      slugsIn(resolve(appRoot, `src/content/${locale}/docs`))
    ])
  );
  for (const [locale, slugs] of Object.entries(translatedDocs)) {
    const orphans = slugs.filter((slug) => !englishDocs.includes(slug));
    if (orphans.length > 0) {
      throw new Error(
        `src/content/${locale}/docs has no English original for: ${orphans.join(', ')}`
      );
    }
  }

  return [...MARKETING_PATHS, ...englishDocs.map((slug) => `/docs/${slug}`)].map((path) => {
    const locales = pageLocales(path, translatedDocs, englishDocs);
    return {
      path,
      locales,
      urls: Object.fromEntries(locales.map((locale) => [locale, localizePath(path, locale)]))
    };
  });
}

/** Every URL to prerender: each page once per locale it exists in. */
export function prerenderRoutes(appRoot) {
  return publicPages(appRoot).flatMap((page) => Object.values(page.urls));
}
