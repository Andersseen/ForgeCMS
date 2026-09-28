import type { AnyField, CollectionDefinition, FieldMap } from '@forge-cms/core';

/**
 * Localization utilities for handling localized fields and locale resolution.
 *
 * Localized fields store values as objects with locale codes as keys:
 * `{ en: "Hello", es: "Hola" }`
 *
 * Locale resolution follows a fallback chain:
 * - Exact match: `es-MX` -> value for `es-MX`
 * - Language fallback: `es-MX` -> value for `es`
 * - Default fallback: first locale in collection's locales array
 */

/**
 * Resolves the locale to use for reading a localized field.
 * Returns the best matching locale from the available locales.
 */
export function resolveLocale(
  requestedLocale: string | undefined,
  availableLocales: string[]
): string {
  if (!requestedLocale || availableLocales.length === 0) {
    return availableLocales[0] ?? 'en';
  }

  // Exact match
  if (availableLocales.includes(requestedLocale)) {
    return requestedLocale;
  }

  // Language fallback (e.g., es-MX -> es)
  const language = requestedLocale.split('-')[0];
  if (language && availableLocales.includes(language)) {
    return language;
  }

  // Find any locale with matching language prefix
  const matchingLocale = availableLocales.find((locale) => locale.startsWith(language + '-'));
  if (matchingLocale) {
    return matchingLocale;
  }

  // Default to first available locale
  return availableLocales[0] ?? 'en';
}

/**
 * Gets the value for a specific locale from a localized field value.
 * Implements fallback chain: exact -> language -> default.
 */
export function getLocalizedValue(
  localizedValue: Record<string, unknown> | unknown,
  locale: string,
  availableLocales: string[]
): unknown {
  if (
    typeof localizedValue !== 'object' ||
    localizedValue === null ||
    Array.isArray(localizedValue)
  ) {
    return localizedValue;
  }

  const valueObj = localizedValue as Record<string, unknown>;
  const resolvedLocale = resolveLocale(locale, availableLocales);

  // Try exact locale
  if (valueObj[resolvedLocale] !== undefined) {
    return valueObj[resolvedLocale];
  }

  // Try language fallback
  const language = resolvedLocale.split('-')[0];
  if (language && valueObj[language] !== undefined) {
    return valueObj[language];
  }

  // Try default locale (first in array)
  const defaultLocale = availableLocales[0];
  if (defaultLocale && valueObj[defaultLocale] !== undefined) {
    return valueObj[defaultLocale];
  }

  // Return first available value
  const firstKey = Object.keys(valueObj)[0];
  return firstKey ? valueObj[firstKey] : undefined;
}

/**
 * Sets a value for a specific locale in a localized field.
 * Returns the updated localized value object.
 */
export function setLocalizedValue(
  currentValue: Record<string, unknown> | unknown,
  locale: string,
  newValue: unknown
): Record<string, unknown> {
  const existing =
    typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)
      ? { ...(currentValue as Record<string, unknown>) }
      : {};

  existing[locale] = newValue;
  return existing;
}

/**
 * Checks if a collection has localization enabled.
 */
export function isLocalizedCollection(collection: CollectionDefinition): boolean {
  return collection.locales !== undefined && collection.locales.length > 0;
}

/**
 * Checks if a field is localized.
 */
export function isLocalizedField(field: { options: { localized?: boolean } }): boolean {
  return field.options.localized === true;
}

/**
 * Extracts the locale from query parameters or headers.
 */
export function extractLocaleFromRequest(
  request: Request,
  collection: CollectionDefinition
): string | undefined {
  // Try query parameter first
  const url = new URL(request.url);
  const queryLocale = url.searchParams.get('locale');
  if (queryLocale && collection.locales?.includes(queryLocale)) {
    return queryLocale;
  }

  // Try Accept-Language header
  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage && collection.locales) {
    // Parse Accept-Language header (e.g., "en-US,en;q=0.9,es;q=0.8")
    const languages = acceptLanguage.split(',').map((lang) => {
      const [code, q] = lang.trim().split(';q=');
      return { code: code?.trim(), quality: q ? parseFloat(q) : 1.0 };
    });

    // Sort by quality descending
    languages.sort((a, b) => b.quality - a.quality);

    // Find first matching locale
    for (const { code } of languages) {
      if (code && collection.locales.includes(code)) {
        return code;
      }
      // Try language fallback
      const language = code?.split('-')[0];
      if (language && collection.locales.includes(language)) {
        return language;
      }
    }
  }

  return undefined;
}

/**
 * Processes a document for reading, resolving localized fields to the requested locale.
 */
export function resolveLocalizedDocument(
  document: Record<string, unknown>,
  collection: CollectionDefinition,
  locale: string | undefined
): Record<string, unknown> {
  if (!isLocalizedCollection(collection) || !locale) {
    return document;
  }

  const resolved: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(document)) {
    const field = collection.fields[fieldName];
    if (field && isLocalizedField(field)) {
      resolved[fieldName] = getLocalizedValue(value, locale, collection.locales!);
    } else {
      resolved[fieldName] = value;
    }
  }

  return resolved;
}

/**
 * Processes a document for writing, storing values in the appropriate locale.
 */
export function storeLocalizedDocument(
  data: Record<string, unknown>,
  collection: CollectionDefinition,
  locale: string | undefined,
  existing?: Record<string, unknown>
): Record<string, unknown> {
  if (!isLocalizedCollection(collection) || !locale) {
    return data;
  }

  const stored: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(data)) {
    const field = collection.fields[fieldName];
    if (field && isLocalizedField(field)) {
      const existingValue = existing?.[fieldName];
      stored[fieldName] = setLocalizedValue(existingValue, locale, value);
    } else {
      stored[fieldName] = value;
    }
  }

  return stored;
}

/** The field kinds whose per-locale values ForgeCMS validates and stores (spec 066). */
const LOCALIZABLE_KINDS: ReadonlySet<string> = new Set(['text', 'textarea']);

/**
 * The `localized` configurations no read or write can honour (spec 066), found at startup so they are
 * refused instead of accepted and silently broken. One message per problem; empty = supported.
 *
 * - a localized field on a collection/global without `locales`: nothing can address a locale;
 * - a localized field of a kind other than `text`/`textarea`: core validation only understands
 *   per-locale strings, so such a field could never be written (a number, boolean, select…) or its
 *   per-locale values would go unvalidated (a slug or email format);
 * - a localized field inside a `group`/`array`/`blocks`: locale storage only addresses top-level fields.
 *
 * Localized `relation`/`upload` fields are left to spec 064's relation validation, which refuses them.
 */
export function validateLocalizationSchema(
  owners: readonly { label: string; fields: CollectionDefinition['fields']; locales?: string[] }[]
): string[] {
  const errors: string[] = [];
  for (const owner of owners) {
    const hasLocales = owner.locales !== undefined && owner.locales.length > 0;
    for (const [name, field] of Object.entries(owner.fields)) {
      for (const path of nestedLocalized(field, name)) {
        errors.push(
          `${owner.label}: field '${path}' is localized inside a ${field.kind} field. Locale storage only ` +
            `addresses top-level fields, so it could never hold one value per locale (spec 066). Localize ` +
            `a top-level field instead.`
        );
      }
      if (!isLocalizedField(field) || field.kind === 'relation' || field.kind === 'upload')
        continue;
      if (!LOCALIZABLE_KINDS.has(field.kind)) {
        errors.push(
          `${owner.label}: field '${name}' is a localized ${field.kind} field. Only text and textarea ` +
            `fields can be localized: per-locale values of other kinds are not validated, and most could ` +
            `never be written (spec 066).`
        );
      } else if (!hasLocales) {
        errors.push(
          `${owner.label}: field '${name}' is localized but no locales are declared, so no read or write ` +
            `could address a locale (spec 066). Add \`locales: [...]\`, or drop \`localized\`.`
        );
      }
    }
  }
  return errors;
}

function nestedLocalized(field: AnyField, path: string): string[] {
  const maps =
    field.kind === 'group' || field.kind === 'array'
      ? [field.options.fields]
      : field.kind === 'blocks'
        ? field.options.blocks.map((block) => block.fields as FieldMap)
        : [];
  const found: string[] = [];
  for (const fields of maps) {
    for (const [name, inner] of Object.entries(fields)) {
      const innerPath = `${path}.${name}`;
      if (isLocalizedField(inner)) found.push(innerPath);
      found.push(...nestedLocalized(inner, innerPath));
    }
  }
  return found;
}
