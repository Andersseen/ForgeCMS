import { flattenMessages } from '@etyma/core';
import en from './catalogs/en.json';

/**
 * Test-only: the English text behind catalog keys, so content tests (honesty guards such as "never
 * claims a page builder") keep reading the words a visitor sees, now that data tables hold keys.
 */
const english = flattenMessages(en);

/** The English message for `key`; throws for an unknown key so a typo cannot pass silently. */
export function englishText(key: string): string {
  const message = english.get(key);
  if (message === undefined) throw new Error(`Unknown catalog key: ${key}`);
  return message;
}

/** Deep copy of `value` with every catalog-key string (and `{ key }` label) replaced by its English. */
export function inEnglish(value: unknown): unknown {
  if (typeof value === 'string') return english.get(value) ?? value;
  if (Array.isArray(value)) return value.map(inEnglish);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['key'] === 'string' && Object.keys(record).length === 1) {
      return englishText(record['key']);
    }
    if (typeof record['literal'] === 'string' && Object.keys(record).length === 1) {
      return record['literal'];
    }
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, inEnglish(v)]));
  }
  return value;
}
