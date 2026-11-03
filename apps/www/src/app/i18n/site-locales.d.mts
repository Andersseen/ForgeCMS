import type { LocaleRouter } from '@etyma/core';

export type SiteLocale = 'en' | 'es' | 'uk';
export type PrefixedLocale = Exclude<SiteLocale, 'en'>;

export const SOURCE_LOCALE: 'en';
export const SITE_LOCALES: readonly ['en', 'es', 'uk'];
export const PREFIXED_LOCALES: readonly ['es', 'uk'];
export const LOCALE_META: Readonly<
  Record<
    SiteLocale,
    { readonly name: string; readonly htmlLang: string; readonly ogLocale: string }
  >
>;
export const MARKETING_PATHS: readonly ['/', '/demo', '/privacy'];

export const localeRouter: LocaleRouter;

export function isSiteLocale(value: unknown): value is SiteLocale;
export function isPrefixedLocale(value: unknown): value is PrefixedLocale;
export function stripLocale(path: string): string;
export function localeOfPath(path: string): SiteLocale;
export function localizePath(path: string, locale: SiteLocale): string;
export function docsSlugOf(path: string): string | null;
export function pageLocales(
  path: string,
  translatedDocs: Readonly<Partial<Record<PrefixedLocale, readonly string[]>>>,
  englishDocs: readonly string[]
): SiteLocale[];
