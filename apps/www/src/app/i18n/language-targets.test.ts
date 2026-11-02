import { describe, expect, it } from 'vitest';
import { languageTargets } from './language-targets';

const urls = (targets: ReturnType<typeof languageTargets>) =>
  Object.fromEntries(targets.map((target) => [target.locale, target.url]));

describe('language switcher targets (spec 101)', () => {
  it('keeps the same marketing page, its query and its fragment', () => {
    const targets = languageTargets('/demo?ref=x#explore-title', 'en', ['en', 'es', 'uk']);
    expect(urls(targets)).toEqual({
      en: '/demo?ref=x#explore-title',
      es: '/es/demo?ref=x#explore-title',
      uk: '/uk/demo?ref=x#explore-title'
    });
    expect(targets.find((t) => t.current)?.locale).toBe('en');
    expect(targets.some((t) => t.fallback)).toBe(false);
  });

  it('switches from a prefixed locale without double prefixes', () => {
    expect(urls(languageTargets('/uk', 'uk', ['en', 'es', 'uk']))).toEqual({
      en: '/',
      es: '/es',
      uk: '/uk'
    });
  });

  it('drops the fragment between docs translations, whose heading ids differ', () => {
    const targets = languageTargets('/es/docs/quickstart#requisitos-previos', 'es', [
      'en',
      'es',
      'uk'
    ]);
    expect(urls(targets)).toEqual({
      en: '/docs/quickstart',
      es: '/es/docs/quickstart#requisitos-previos',
      uk: '/uk/docs/quickstart'
    });
  });

  it('falls back to the docs home for an untranslated article, and says so', () => {
    const targets = languageTargets('/docs/fields?x=1#options', 'en', ['en']);
    expect(urls(targets)).toEqual({
      en: '/docs/fields?x=1#options',
      es: '/es/docs/introduction',
      uk: '/uk/docs/introduction'
    });
    expect(targets.filter((t) => t.fallback).map((t) => t.locale)).toEqual(['es', 'uk']);
  });

  it('sends a 404 to each locale home', () => {
    expect(urls(languageTargets('/es/not-a-page', 'es', []))).toEqual({
      en: '/',
      es: '/es',
      uk: '/uk'
    });
  });

  it('labels each language by its own name', () => {
    expect(languageTargets('/', 'en', ['en', 'es', 'uk']).map((t) => t.name)).toEqual([
      'English',
      'Español',
      'Українська'
    ]);
  });
});
