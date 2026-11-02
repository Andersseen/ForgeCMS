import { describe, expect, it } from 'vitest';
import {
  LOCALE_META,
  SITE_LOCALES,
  docsSlugOf,
  isPrefixedLocale,
  isSiteLocale,
  localeOfPath,
  localizePath,
  pageLocales,
  stripLocale
} from './site-locales.mjs';

describe('site locale model (spec 101)', () => {
  it('knows exactly en (source), es and uk', () => {
    expect(SITE_LOCALES).toEqual(['en', 'es', 'uk']);
    expect(Object.keys(LOCALE_META)).toEqual(['en', 'es', 'uk']);
    expect(LOCALE_META.uk.name).toBe('Українська');
    for (const value of ['en', 'es', 'uk']) expect(isSiteLocale(value)).toBe(true);
    for (const value of ['EN', 'fr', 'es-ES', '', undefined, 'docs']) {
      expect(isSiteLocale(value)).toBe(false);
    }
    expect(isPrefixedLocale('en')).toBe(false);
    expect(isPrefixedLocale('uk')).toBe(true);
  });

  it('reads the locale from the URL prefix only', () => {
    expect(localeOfPath('/')).toBe('en');
    expect(localeOfPath('/demo')).toBe('en');
    expect(localeOfPath('/es')).toBe('es');
    expect(localeOfPath('/uk/docs/quickstart?x=1')).toBe('uk');
    expect(localeOfPath('/esx/demo')).toBe('en');
    expect(localeOfPath('/fr/demo')).toBe('en');
  });

  it('strips a locale prefix, including the redirect-only /en', () => {
    expect(stripLocale('/es')).toBe('/');
    expect(stripLocale('/es/')).toBe('/');
    expect(stripLocale('/uk/docs/quickstart')).toBe('/docs/quickstart');
    expect(stripLocale('/en/demo?a=1#b')).toBe('/demo?a=1#b');
    expect(stripLocale('/demo')).toBe('/demo');
  });

  it('localizes without ever double-prefixing, keeping query and fragment', () => {
    expect(localizePath('/', 'es')).toBe('/es');
    expect(localizePath('/docs/quickstart', 'uk')).toBe('/uk/docs/quickstart');
    expect(localizePath('/es/demo#explore', 'uk')).toBe('/uk/demo#explore');
    expect(localizePath('/uk/demo?ref=a', 'en')).toBe('/demo?ref=a');
    expect(localizePath('/es/es', 'es')).toBe('/es/es');
  });

  it('recognises docs article paths', () => {
    expect(docsSlugOf('/docs/small-project-guide')).toBe('small-project-guide');
    expect(docsSlugOf('/docs')).toBeNull();
    expect(docsSlugOf('/docs/a/b')).toBeNull();
  });

  it('lists a page only in the locales it really exists in', () => {
    const english = ['introduction', 'quickstart', 'fields'];
    const translated = { es: ['introduction', 'quickstart'], uk: ['introduction'] };
    expect(pageLocales('/', translated, english)).toEqual(['en', 'es', 'uk']);
    expect(pageLocales('/privacy', translated, english)).toEqual(['en', 'es', 'uk']);
    expect(pageLocales('/docs/introduction', translated, english)).toEqual(['en', 'es', 'uk']);
    expect(pageLocales('/docs/quickstart', translated, english)).toEqual(['en', 'es']);
    expect(pageLocales('/docs/fields', translated, english)).toEqual(['en']);
    expect(pageLocales('/docs/missing', translated, english)).toEqual([]);
    expect(pageLocales('/admin', translated, english)).toEqual([]);
  });
});
