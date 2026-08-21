import type { CollectionDefinition } from '@forge-cms/core';

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
