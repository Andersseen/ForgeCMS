import {
  LOCALE_META,
  SITE_LOCALES,
  docsSlugOf,
  localizePath,
  stripLocale,
  type SiteLocale
} from './site-locales.mjs';

export interface LanguageTarget {
  readonly locale: SiteLocale;
  /** The endonym: `Español`, `Українська` — the same in every UI language. */
  readonly name: string;
  readonly code: string;
  readonly url: string;
  readonly current: boolean;
  /** The page does not exist in this locale, so `url` is that locale's docs or site home instead. */
  readonly fallback: boolean;
}

/**
 * Where each language entry sends the reader from `url` (spec 101).
 *
 * - The page exists in the target locale → the same page, query kept. The fragment is kept too,
 *   except between docs articles: their heading ids come from translated headings and differ.
 * - It does not (an English-only docs article, a 404) → the target's docs introduction or home page,
 *   flagged `fallback` so the menu can say so. Never a localized URL with nothing behind it.
 */
export function languageTargets(
  url: string,
  current: SiteLocale,
  available: readonly SiteLocale[]
): LanguageTarget[] {
  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt);
  const withoutFragment = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutFragment.indexOf('?');
  const query = queryAt === -1 ? '' : withoutFragment.slice(queryAt);
  const path = stripLocale(queryAt === -1 ? withoutFragment : withoutFragment.slice(0, queryAt));
  const isDocsArticle = docsSlugOf(path) !== null;

  return SITE_LOCALES.map((locale) => {
    const exists = available.includes(locale);
    const target = exists ? path : isDocsArticle ? '/docs/introduction' : '/';
    const keepFragment = exists && (!isDocsArticle || locale === current);
    return {
      locale,
      name: LOCALE_META[locale].name,
      code: locale.toUpperCase(),
      url: `${localizePath(target, locale)}${exists ? query : ''}${keepFragment ? fragment : ''}`,
      current: locale === current,
      fallback: !exists
    };
  });
}
