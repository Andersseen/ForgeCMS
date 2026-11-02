/**
 * The website's locale model (spec 101), shared by the Angular app and the build scripts (sitemap,
 * prerender list, catalog pull) so they can never disagree about which URLs exist.
 *
 * The URL is the only source of truth for the language: English is served unprefixed, Spanish under
 * `/es`, Ukrainian under `/uk`. A page exists in a locale only when it is really translated there —
 * the marketing pages are complete in all three; a docs article exists in a translated locale only
 * when `src/content/<locale>/docs/<slug>.md` exists.
 */

import { createLocaleRouter } from '@etyma/core';

export const SOURCE_LOCALE = 'en';
export const SITE_LOCALES = /** @type {const} */ (['en', 'es', 'uk']);
/** Locales served under a path prefix: every locale except the source. */
export const PREFIXED_LOCALES = /** @type {const} */ (['es', 'uk']);

/** Endonyms (never translated), `<html lang>` and Open Graph locale per site locale. */
export const LOCALE_META = {
  en: { name: 'English', htmlLang: 'en', ogLocale: 'en_US' },
  es: { name: 'Español', htmlLang: 'es', ogLocale: 'es_ES' },
  uk: { name: 'Українська', htmlLang: 'uk', ogLocale: 'uk_UA' }
};

/** Public pages that are fully translated in every site locale. */
export const MARKETING_PATHS = /** @type {const} */ (['/', '/demo', '/privacy']);

/** @param {unknown} value */
export function isSiteLocale(value) {
  return typeof value === 'string' && SITE_LOCALES.includes(/** @type {never} */ (value));
}

/** @param {unknown} value */
export function isPrefixedLocale(value) {
  return typeof value === 'string' && PREFIXED_LOCALES.includes(/** @type {never} */ (value));
}

/**
 * Etyma's locale router: `strip('/es/docs/x?a#b')` → `/docs/x?a#b`, `localize('/docs', 'uk')` →
 * `/uk/docs`, the source locale unprefixed. It is the one implementation of prefix handling; the
 * helpers below only name the site's use of it.
 */
export const localeRouter = createLocaleRouter({
  locales: SITE_LOCALES,
  sourceLocale: SOURCE_LOCALE
});

/** `/es/docs/x` → `/docs/x`, `/uk` → `/`, `/en/demo` → `/demo`. */
export function stripLocale(path) {
  return localeRouter.strip(path);
}

/** The locale a path is served in. Anything without a known prefix is the source locale. */
export function localeOfPath(path) {
  return localeRouter.localeOf(path);
}

/** `/docs/x` in `es` → `/es/docs/x`; the source locale stays unprefixed. Never double-prefixes. */
export function localizePath(path, locale) {
  return localeRouter.localize(path, locale);
}

/** The docs article slug of an unprefixed path, or `null` when the path is not a docs article. */
export function docsSlugOf(path) {
  const match = /^\/docs\/([a-z0-9-]+)$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * The locales an unprefixed page path really exists in, source first. Marketing pages exist in every
 * locale; a docs article in English plus every locale that has its translation; anything else (a 404,
 * an admin route) in none, so it never gets alternates.
 *
 * @param {string} path an unprefixed path, e.g. `/docs/quickstart`
 * @param {Readonly<Record<string, readonly string[]>>} translatedDocs slugs translated per prefixed locale
 * @param {readonly string[]} englishDocs every English docs slug
 */
export function pageLocales(path, translatedDocs, englishDocs) {
  if (MARKETING_PATHS.includes(/** @type {never} */ (path))) return [...SITE_LOCALES];
  const slug = docsSlugOf(path);
  if (slug === null || !englishDocs.includes(slug)) return [];
  return [
    SOURCE_LOCALE,
    ...PREFIXED_LOCALES.filter((locale) => translatedDocs[locale]?.includes(slug) ?? false)
  ];
}
