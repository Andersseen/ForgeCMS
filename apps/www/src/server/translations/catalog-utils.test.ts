import { describe, expect, it } from 'vitest';
import {
  flattenCatalog,
  unflattenCatalog,
  validateTranslationKey,
  validateLocale,
  validateProjectLocales
} from './catalog-utils.js';

describe('flattenCatalog', () => {
  it('flattens a simple nested catalog', () => {
    const result = flattenCatalog({
      nav: {
        docs: 'Docs',
        components: 'Components'
      },
      footer: {
        rights: '© {$year}'
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.entries.size).toBe(3);
    expect(result.entries.get('nav.docs')).toBe('Docs');
    expect(result.entries.get('nav.components')).toBe('Components');
    expect(result.entries.get('footer.rights')).toBe('© {$year}');
  });

  it('handles a flat catalog with no nesting', () => {
    const result = flattenCatalog({
      hello: 'Hello',
      goodbye: 'Goodbye'
    });

    expect(result.errors).toHaveLength(0);
    expect(result.entries.size).toBe(2);
    expect(result.entries.get('hello')).toBe('Hello');
    expect(result.entries.get('goodbye')).toBe('Goodbye');
  });

  it('handles deeply nested catalogs', () => {
    const result = flattenCatalog({
      a: { b: { c: { d: 'deep' } } }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.entries.get('a.b.c.d')).toBe('deep');
  });

  it('handles an empty catalog', () => {
    const result = flattenCatalog({});
    expect(result.errors).toHaveLength(0);
    expect(result.entries.size).toBe(0);
  });

  it('reports errors for array values', () => {
    const result = flattenCatalog({
      nav: ['item1', 'item2']
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('nav');
    expect(result.errors[0]!.reason).toContain('Arrays');
  });

  it('reports errors for null values', () => {
    const result = flattenCatalog({
      nav: { title: null }
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('nav.title');
    expect(result.errors[0]!.reason).toContain('Null');
  });

  it('reports errors for number values', () => {
    const result = flattenCatalog({
      count: 42
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('count');
    expect(result.errors[0]!.reason).toContain('number');
  });

  it('reports errors for boolean values', () => {
    const result = flattenCatalog({
      enabled: true
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('enabled');
    expect(result.errors[0]!.reason).toContain('boolean');
  });

  it('preserves message values with special characters', () => {
    const result = flattenCatalog({
      greeting: 'Hello {$name}, welcome to {$place}!',
      html: '<b>Bold</b> & <i>italic</i>'
    });

    expect(result.errors).toHaveLength(0);
    expect(result.entries.get('greeting')).toBe('Hello {$name}, welcome to {$place}!');
    expect(result.entries.get('html')).toBe('<b>Bold</b> & <i>italic</i>');
  });

  it('handles mixed valid and invalid entries', () => {
    const result = flattenCatalog({
      valid: 'ok',
      invalid: 42,
      nested: {
        good: 'fine',
        bad: null
      }
    });

    expect(result.entries.size).toBe(2);
    expect(result.errors).toHaveLength(2);
  });
});

describe('unflattenCatalog', () => {
  it('rebuilds nested structure from flat keys', () => {
    const result = unflattenCatalog({
      'nav.docs': 'Docs',
      'nav.components': 'Components',
      'footer.rights': '© {$year}'
    });

    expect(result).toEqual({
      footer: { rights: '© {$year}' },
      nav: { components: 'Components', docs: 'Docs' }
    });
  });

  it('produces deterministic alphabetical ordering', () => {
    const result = unflattenCatalog({
      'z.key': 'Z',
      'a.key': 'A',
      'm.key': 'M'
    });

    const keys = Object.keys(result);
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  it('handles flat keys without dots', () => {
    const result = unflattenCatalog({
      hello: 'Hello',
      goodbye: 'Goodbye'
    });

    expect(result).toEqual({ goodbye: 'Goodbye', hello: 'Hello' });
  });

  it('handles empty input', () => {
    expect(unflattenCatalog({})).toEqual({});
  });

  it('round-trips with flattenCatalog', () => {
    const original = {
      nav: {
        docs: 'Docs',
        components: 'Components'
      },
      footer: {
        rights: '© {$year}'
      }
    };

    const flattened = flattenCatalog(original);
    const flat: Record<string, string> = {};
    for (const [k, v] of flattened.entries) flat[k] = v;
    const rebuilt = unflattenCatalog(flat);

    expect(rebuilt).toEqual({
      footer: { rights: '© {$year}' },
      nav: { components: 'Components', docs: 'Docs' }
    });
  });
});

describe('validateTranslationKey', () => {
  it('accepts valid simple keys', () => {
    expect(validateTranslationKey('hello')).toEqual({ valid: true });
    expect(validateTranslationKey('nav')).toEqual({ valid: true });
  });

  it('accepts valid dotted keys', () => {
    expect(validateTranslationKey('nav.docs')).toEqual({ valid: true });
    expect(validateTranslationKey('docs.installation.title')).toEqual({ valid: true });
    expect(validateTranslationKey('errors.404.title')).toEqual({ valid: true });
  });

  it('accepts keys with hyphens and underscores', () => {
    expect(validateTranslationKey('nav-item.title')).toEqual({ valid: true });
    expect(validateTranslationKey('my_key.sub_key')).toEqual({ valid: true });
  });

  it('rejects empty keys', () => {
    const result = validateTranslationKey('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects keys starting with a dot', () => {
    const result = validateTranslationKey('.foo');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('start with a dot');
  });

  it('rejects keys ending with a dot', () => {
    const result = validateTranslationKey('foo.');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('end with a dot');
  });

  it('rejects keys with consecutive dots', () => {
    const result = validateTranslationKey('foo..bar');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('consecutive dots');
  });

  it('rejects keys with spaces', () => {
    const result = validateTranslationKey('foo bar');
    expect(result.valid).toBe(false);
  });

  it('rejects keys with special characters', () => {
    expect(validateTranslationKey('foo@bar').valid).toBe(false);
    expect(validateTranslationKey('foo/bar').valid).toBe(false);
    expect(validateTranslationKey('foo[0]').valid).toBe(false);
  });
});

describe('validateLocale', () => {
  it('accepts standard two-letter locales', () => {
    expect(validateLocale('en')).toBe(true);
    expect(validateLocale('es')).toBe(true);
    expect(validateLocale('uk')).toBe(true);
    expect(validateLocale('fr')).toBe(true);
    expect(validateLocale('de')).toBe(true);
  });

  it('accepts locales with region subtags', () => {
    expect(validateLocale('en-US')).toBe(true);
    expect(validateLocale('pt-BR')).toBe(true);
    expect(validateLocale('es-MX')).toBe(true);
  });

  it('accepts locales with script subtags', () => {
    expect(validateLocale('zh-Hant')).toBe(true);
    expect(validateLocale('zh-Hans')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(validateLocale('')).toBe(false);
    expect(validateLocale('E')).toBe(false);
    expect(validateLocale('english')).toBe(false);
    expect(validateLocale('EN')).toBe(false);
    expect(validateLocale('en-us')).toBe(false);
  });
});

describe('validateProjectLocales', () => {
  it('accepts valid locale arrays', () => {
    const result = validateProjectLocales(['en', 'es', 'uk']);
    expect(result.valid).toBe(true);
    expect(result.locales).toEqual(['en', 'es', 'uk']);
  });

  it('rejects non-arrays', () => {
    expect(validateProjectLocales('en').valid).toBe(false);
    expect(validateProjectLocales(null).valid).toBe(false);
    expect(validateProjectLocales(42).valid).toBe(false);
  });

  it('rejects empty arrays', () => {
    const result = validateProjectLocales([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('At least one');
  });

  it('rejects non-string elements', () => {
    const result = validateProjectLocales(['en', 42]);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid locale formats', () => {
    const result = validateProjectLocales(['en', 'invalid']);
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate locales', () => {
    const result = validateProjectLocales(['en', 'en']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Duplicate');
  });
});
