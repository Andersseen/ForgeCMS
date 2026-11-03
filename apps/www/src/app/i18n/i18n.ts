import { defineI18n, type I18nKeysWithoutRequiredParams } from '@etyma/core';
import en from './catalogs/en.json';
import contract from './contract.generated';
import { SITE_LOCALES, SOURCE_LOCALE } from './site-locales.mjs';

/**
 * The website's Etyma definition (spec 101).
 *
 * The catalogs are a build-time snapshot of the Glossa project (`scripts/i18n-catalogs.mjs pull`);
 * edit translations in Glossa, never in these files. English is the source and the type contract; the
 * other locales are lazy chunks of this build, so the prerendered HTML and the hydrated app always
 * read the same strings and no third-party request is made at runtime.
 */
export const i18n = defineI18n({
  id: 'forgecms-www',
  locales: SITE_LOCALES,
  sourceLocale: SOURCE_LOCALE,
  source: en,
  contract,
  loaders: {
    es: () => import('./catalogs/es.json'),
    uk: () => import('./catalogs/uk.json')
  }
});

/** A catalog key that needs no params — what data tables (`labelKey`, `titleKey`) may hold. */
export type SiteMessageKey = I18nKeysWithoutRequiredParams<typeof i18n>;

/** A visible label: a catalog key, or literal text that is never translated (a command, a name). */
export type SiteText = { readonly key: SiteMessageKey } | { readonly literal: string };

/** The text of a {@link SiteText} in the active locale. */
export function textOf(t: (key: SiteMessageKey) => string, text: SiteText): string {
  return 'key' in text ? t(text.key) : text.literal;
}
