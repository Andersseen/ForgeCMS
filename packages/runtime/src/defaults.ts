import { slugify } from '@forge-cms/core';
import type { CollectionDefinition, SlugFieldOptions } from '@forge-cms/core';

/**
 * The two field options that used to be declared and never read (spec 040, demo finding 1):
 * `defaultValue` on any field, and `autoGenerate`/`sourceField` on a `slug`.
 *
 * Both run at the very start of a write, before `beforeValidate` hooks, so a hook can still override
 * whatever they produced — and so validation sees the final value.
 */

/** Fields whose incoming value is `undefined` take their `defaultValue`. Create only. */
export function applyFieldDefaults(
  collection: CollectionDefinition,
  data: Record<string, unknown>
): Record<string, unknown> {
  let result = data;

  for (const [name, field] of Object.entries(collection.fields)) {
    const defaultValue = field.options.defaultValue;
    if (defaultValue === undefined || result[name] !== undefined) continue;
    // Copy lazily: most writes set every field they care about and need no new object at all.
    if (result === data) result = { ...data };
    result[name] = defaultValue;
  }

  return result;
}

/** Candidate source fields when a `slug` declares `autoGenerate` without naming one. */
const IMPLICIT_SLUG_SOURCES = ['title', 'name'];

/**
 * Fills `slug` fields marked `autoGenerate` from their source field, and normalises any slug the
 * caller did provide.
 *
 * Runs on create and update. `existing` is the stored document on update, so renaming nothing but
 * the title of a document whose slug was auto-generated does **not** silently break its URL — an
 * existing non-empty slug is kept unless the caller explicitly clears it.
 */
export function applyAutoSlugs(
  collection: CollectionDefinition,
  data: Record<string, unknown>,
  existing?: Record<string, unknown>
): Record<string, unknown> {
  let result = data;

  for (const [name, field] of Object.entries(collection.fields)) {
    if (field.kind !== 'slug') continue;

    const provided = result[name];
    const hasProvided = typeof provided === 'string' && provided.trim() !== '';

    if (hasProvided) {
      const normalised = slugify(provided);
      if (normalised !== provided) {
        if (result === data) result = { ...data };
        result[name] = normalised;
      }
      continue;
    }

    const options = field.options as SlugFieldOptions;
    if (options.autoGenerate !== true) continue;

    // On update, an untouched field is absent from a partial body — leave the stored slug alone.
    const clearedExplicitly = provided !== undefined;
    const storedSlug = existing?.[name];
    if (!clearedExplicitly && typeof storedSlug === 'string' && storedSlug !== '') continue;

    const merged = { ...existing, ...result };
    const sourceNames = options.sourceField ? [options.sourceField] : IMPLICIT_SLUG_SOURCES;
    const source = sourceNames
      .map((sourceName) => merged[sourceName])
      .find((value): value is string => typeof value === 'string' && value.trim() !== '');
    if (source === undefined) continue;

    const generated = slugify(source);
    if (generated === '') continue;

    if (result === data) result = { ...data };
    result[name] = generated;
  }

  return result;
}
