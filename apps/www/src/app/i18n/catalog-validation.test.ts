import { describe, expect, it } from 'vitest';
import {
  createMessageFormatter,
  createTranslator,
  flattenMessages,
  type MessageSource
} from '@etyma/core';
import { extractContractKeys, extractContractParams, validateCatalogs } from '@etyma/tooling';
import en from './catalogs/en.json';
import es from './catalogs/es.json';
import uk from './catalogs/uk.json';
import contract from './contract.generated';
import { i18n } from './i18n';

const catalogs: Record<string, MessageSource> = { en, es, uk };

describe('translation catalogs (spec 101)', () => {
  it('pass Etyma validation: key parity, MessageFormat 2, variable parity', () => {
    const result = validateCatalogs({ sourceLocale: 'en', catalogs });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('report a missing translation and an extra key instead of passing them', () => {
    const broken = JSON.parse(JSON.stringify(es)) as Record<string, Record<string, string>>;
    delete broken['footer']!['title'];
    broken['footer']!['stray'] = 'x';
    const result = validateCatalogs({ sourceLocale: 'en', catalogs: { en, es: broken } });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => `${d.code}:${d.key}`)).toEqual(
      expect.arrayContaining(['catalog.missing-key:footer.title', 'catalog.extra-key:footer.stray'])
    );
  });

  it('keep the committed typed contract in sync with the English source', () => {
    const params = extractContractParams(en, { strict: true });
    expect(contract.keys).toEqual(extractContractKeys(en));
    expect(contract.variables).toEqual(params.variables);
    expect(contract.functions).toEqual(params.functions);
  });

  it('never ship an empty translation or one identical to a long English sentence', () => {
    const source = flattenMessages(en);
    for (const locale of ['es', 'uk'] as const) {
      const translated = flattenMessages(catalogs[locale]!);
      const untranslated = [...source].filter(
        ([key, text]) => text.length > 40 && translated.get(key) === text
      );
      expect(
        untranslated.map(([key]) => key),
        locale
      ).toEqual([]);
    }
  });

  it('format variables and Ukrainian plurals through MessageFormat 2', () => {
    const formatter = createMessageFormatter();
    const translate = (locale: 'en' | 'es' | 'uk', key: string, params: Record<string, unknown>) =>
      createTranslator({
        locale,
        catalog: flattenMessages(catalogs[locale]!),
        sourceLocale: 'en',
        sourceCatalog: flattenMessages(en),
        formatter
      }).translate(key, params as never);
    expect(translate('en', 'roadmap.count', { count: 10, next: 'V2-01' })).toBe(
      '10 milestones · V2-01 is next'
    );
    expect(translate('en', 'roadmap.count', { count: 1, next: 'V2-01' })).toBe(
      '1 milestone · V2-01 is next'
    );
    expect(translate('uk', 'roadmap.count', { count: 10, next: 'V2-01' })).toBe(
      '10 етапів · наступний — V2-01'
    );
    expect(translate('uk', 'roadmap.count', { count: 3, next: 'V2-01' })).toBe(
      '3 етапи · наступний — V2-01'
    );
    expect(translate('es', 'hero.badge', { version: '1.0.0' })).toBe(
      'Código abierto · ForgeCMS 1.0.0 · estable'
    );
  });

  it('define exactly the site locales, English as source', () => {
    expect(i18n.locales).toEqual(['en', 'es', 'uk']);
    expect(i18n.sourceLocale).toBe('en');
    expect(i18n.keys.length).toBe(flattenMessages(en).size);
  });
});
