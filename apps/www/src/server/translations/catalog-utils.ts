const KEY_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

export interface FlattenError {
  key: string;
  reason: string;
}

export interface FlattenResult {
  entries: Map<string, string>;
  errors: FlattenError[];
}

export function flattenCatalog(catalog: Record<string, unknown>): FlattenResult {
  const entries = new Map<string, string>();
  const errors: FlattenError[] = [];

  function walk(obj: unknown, prefix: string): void {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      errors.push({
        key: prefix || '(root)',
        reason: Array.isArray(obj)
          ? 'Arrays are not supported as translation namespaces'
          : obj === null
            ? 'Null values are not supported'
            : `Expected an object, got ${typeof obj}`
      });
      return;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        entries.set(fullKey, value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        walk(value, fullKey);
      } else if (Array.isArray(value)) {
        errors.push({
          key: fullKey,
          reason: 'Arrays are not supported as translation values'
        });
      } else if (value === null) {
        errors.push({
          key: fullKey,
          reason: 'Null values are not supported'
        });
      } else {
        errors.push({
          key: fullKey,
          reason: `Expected a string or nested object, got ${typeof value}`
        });
      }
    }
  }

  walk(catalog, '');
  return { entries, errors };
}

export function unflattenCatalog(messages: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const sortedKeys = Object.keys(messages).sort();

  for (const key of sortedKeys) {
    const value = messages[key];
    if (value === undefined) continue;

    const parts = key.split('.');
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1]!;
    current[lastPart] = value;
  }

  return result;
}

export function validateTranslationKey(key: string): { valid: boolean; error?: string } {
  if (key === '') {
    return { valid: false, error: 'Key must not be empty' };
  }

  if (key.startsWith('.')) {
    return { valid: false, error: 'Key must not start with a dot' };
  }

  if (key.endsWith('.')) {
    return { valid: false, error: 'Key must not end with a dot' };
  }

  if (key.includes('..')) {
    return { valid: false, error: 'Key must not contain consecutive dots' };
  }

  const segments = key.split('.');
  for (const segment of segments) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      return {
        valid: false,
        error: `Invalid key segment '${segment}': only alphanumeric, hyphens, and underscores are allowed`
      };
    }
  }

  return { valid: true };
}

export function validateLocale(locale: string): boolean {
  return LOCALE_PATTERN.test(locale);
}

export function validateProjectLocales(locales: unknown): {
  valid: boolean;
  error?: string;
  locales?: string[];
} {
  if (!Array.isArray(locales)) {
    return { valid: false, error: 'Locales must be an array' };
  }

  if (locales.length === 0) {
    return { valid: false, error: 'At least one locale is required' };
  }

  const unique = new Set<string>();
  for (const locale of locales) {
    if (typeof locale !== 'string') {
      return { valid: false, error: 'All locales must be strings' };
    }
    if (!validateLocale(locale)) {
      return { valid: false, error: `Invalid locale format: '${locale}'` };
    }
    if (unique.has(locale)) {
      return { valid: false, error: `Duplicate locale: '${locale}'` };
    }
    unique.add(locale);
  }

  return { valid: true, locales: locales as string[] };
}
