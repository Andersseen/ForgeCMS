import { Injectable, computed } from '@angular/core';
import { injectContentFiles } from '@analogjs/content';
import { injectI18n } from '@etyma/angular';
import { i18n } from './i18n';
import {
  PREFIXED_LOCALES,
  isSiteLocale,
  localizePath,
  pageLocales,
  stripLocale,
  type PrefixedLocale,
  type SiteLocale
} from './site-locales.mjs';

/** `/src/content/es/docs/quickstart.md` → `['es', 'quickstart']`; English docs have no locale dir. */
const LOCALIZED_DOC = /\/content\/(es|uk)\/docs\/([a-z0-9-]+)\.md$/;
const ENGLISH_DOC = /\/content\/docs\/([a-z0-9-]+)\.md$/;

/**
 * The active site locale and what exists in it (spec 101). Which docs are translated comes from the
 * content files Analog collected at build time — the presence of `src/content/<locale>/docs/<slug>.md`
 * is the only signal, so a link, an `hreflang` or a sitemap entry can never name a translation that
 * does not exist.
 */
@Injectable({ providedIn: 'root' })
export class SiteLocaleService {
  readonly i18n = injectI18n(i18n);
  readonly locale = computed<SiteLocale>(() => {
    const locale = this.i18n.locale();
    return isSiteLocale(locale) ? locale : 'en';
  });

  readonly englishDocs: readonly string[];
  readonly translatedDocs: Readonly<Record<PrefixedLocale, readonly string[]>>;

  constructor() {
    const files = injectContentFiles((file) => file.filename.includes('/content/'));
    const english: string[] = [];
    const translated: Record<PrefixedLocale, string[]> = { es: [], uk: [] };
    for (const { filename } of files) {
      const localized = LOCALIZED_DOC.exec(filename);
      if (localized?.[1] && localized[2])
        translated[localized[1] as PrefixedLocale].push(localized[2]);
      const source = ENGLISH_DOC.exec(filename);
      if (source?.[1]) english.push(source[1]);
    }
    this.englishDocs = english;
    this.translatedDocs = translated;
  }

  /** An in-app path in the active locale. */
  path(to: string): string {
    return localizePath(to, this.locale());
  }

  /** Whether the docs article `slug` is translated into `locale` (English always is). */
  hasDoc(slug: string, locale: SiteLocale = this.locale()): boolean {
    if (locale === 'en') return this.englishDocs.includes(slug);
    return this.translatedDocs[locale].includes(slug);
  }

  /**
   * A docs article link for the active locale: the translation when it exists, otherwise the
   * canonical English article — never a localized URL with no translation behind it.
   */
  docsPath(slug: string): string {
    const locale = this.hasDoc(slug) ? this.locale() : 'en';
    return localizePath(`/docs/${slug}`, locale);
  }

  /** The locales the page at `url` (any locale, query/fragment allowed) really exists in. */
  localesOf(url: string): SiteLocale[] {
    const path = stripLocale(url.split(/[?#]/, 1)[0] ?? '/');
    return pageLocales(path, this.translatedDocs, this.englishDocs);
  }

  /** Every locale other than the source, for iteration in templates. */
  readonly prefixedLocales = PREFIXED_LOCALES;
}
