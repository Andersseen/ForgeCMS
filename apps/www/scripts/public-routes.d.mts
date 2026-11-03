import type { SiteLocale } from '../src/app/i18n/site-locales.mjs';

export interface PublicPage {
  /** The unprefixed page path, e.g. `/docs/quickstart`. */
  readonly path: string;
  /** The locales the page really exists in, source first. */
  readonly locales: readonly SiteLocale[];
  /** The page's URL path in each of those locales. */
  readonly urls: Readonly<Partial<Record<SiteLocale, string>>>;
}

export function publicPages(appRoot: string): PublicPage[];
export function prerenderRoutes(appRoot: string): string[];
