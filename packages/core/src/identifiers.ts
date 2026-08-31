import type {
  AnyField,
  ArrayFieldOptions,
  BlocksFieldOptions,
  CollectionDefinition,
  FieldMap,
  GlobalDefinition,
  GroupFieldOptions
} from './index.js';

const IDENTIFIER_PATTERN = /^_?[a-z][a-zA-Z0-9_]*$/;

const SYSTEM_FIELD_NAMES = new Set(['id', 'created_at', 'updated_at', '_status', '_storageKey']);

/**
 * `and`/`or` are reserved top-level keys in a `where` query (spec 050) — a flat filter object
 * carrying one of them would be parsed as a boolean group instead of a field filter. Reserved here so
 * a field can never legally collide with it, the same way system fields are reserved.
 */
const RESERVED_QUERY_KEYWORDS = new Set(['and', 'or']);

/**
 * Prefix reserved for Forge's own internal system collections (e.g. `_forge_api_keys`, machine auth's
 * key store). Those are built directly as plain objects rather than through `defineCollection`/
 * `defineGlobal` — the one legitimate user of this prefix, and the only reason this check lives there
 * rather than in `validateCollectionIdentifiers`/`validateGlobalIdentifiers` below: those two are also
 * reused by `@forge-cms/db`'s schema generator as a defense-in-depth check on *every* collection
 * definition it is handed, Forge-internal ones included, so a reserved-prefix rejection there would
 * reject Forge's own internal collections too. `defineCollection`/`defineGlobal` is specifically the
 * boundary where a *consumer* registers their own collection or global, so that is where a colliding
 * slug is rejected instead of silently shadowing or corrupting Forge-internal storage.
 */
const RESERVED_SLUG_PREFIX = '_forge_';

export function isReservedForgeSlug(slug: string): boolean {
  return slug.startsWith(RESERVED_SLUG_PREFIX);
}

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name);
}

export function assertValidIdentifier(name: string, context: string): void {
  if (!isValidIdentifier(name)) {
    throw new Error(
      `Invalid identifier "${name}" in ${context}. ` +
        `Identifiers must match ${IDENTIFIER_PATTERN.source} (start with a lowercase letter or ` +
        `one internal underscore, contain only letters, digits, and underscores).`
    );
  }
}

export function isSystemField(name: string): boolean {
  return SYSTEM_FIELD_NAMES.has(name);
}

export function getSystemFields(): ReadonlySet<string> {
  return SYSTEM_FIELD_NAMES;
}

function validateFieldIdentifiers(
  fields: FieldMap,
  context: { collectionSlug: string; pathPrefix?: string }
): string[] {
  const errors: string[] = [];

  for (const [fieldName, field] of Object.entries(fields)) {
    const path = context.pathPrefix ? `${context.pathPrefix}.${fieldName}` : fieldName;
    if (!isValidIdentifier(fieldName)) {
      errors.push(
        `Field name "${path}" in collection "${context.collectionSlug}" is not a valid identifier. ` +
          `It must match ${IDENTIFIER_PATTERN.source}.`
      );
    }
    if (SYSTEM_FIELD_NAMES.has(fieldName)) {
      errors.push(
        `Field name "${path}" in collection "${context.collectionSlug}" conflicts with a system field.`
      );
    }
    if (RESERVED_QUERY_KEYWORDS.has(fieldName)) {
      errors.push(
        `Field name "${path}" in collection "${context.collectionSlug}" conflicts with the reserved query keyword "${fieldName}" ("and"/"or" are reserved for nested where queries).`
      );
    }

    errors.push(...validateNestedFieldIdentifiers(field, { ...context, pathPrefix: path }));
  }

  return errors;
}

function validateNestedFieldIdentifiers(
  field: AnyField,
  context: { collectionSlug: string; pathPrefix: string }
): string[] {
  if (field.kind === 'group') {
    return validateFieldIdentifiers((field.options as GroupFieldOptions).fields, context);
  }

  if (field.kind === 'array') {
    return validateFieldIdentifiers((field.options as ArrayFieldOptions).fields, context);
  }

  if (field.kind !== 'blocks') return [];

  const errors: string[] = [];
  const blocks = (field.options as BlocksFieldOptions).blocks;
  for (const block of blocks) {
    if (!isValidIdentifier(block.slug)) {
      errors.push(
        `Block slug "${block.slug}" in collection "${context.collectionSlug}" is not a valid identifier. ` +
          `It must match ${IDENTIFIER_PATTERN.source}.`
      );
    }
    errors.push(
      ...validateFieldIdentifiers(block.fields as FieldMap, {
        collectionSlug: context.collectionSlug,
        pathPrefix: `${context.pathPrefix}.${block.slug}`
      })
    );
  }
  return errors;
}

export function validateCollectionIdentifiers(
  collection: Pick<CollectionDefinition, 'slug' | 'fields'>
): string[] {
  const errors: string[] = [];

  if (!isValidIdentifier(collection.slug)) {
    errors.push(
      `Collection slug "${collection.slug}" is not a valid identifier. ` +
        `It must match ${IDENTIFIER_PATTERN.source}.`
    );
  }

  errors.push(...validateFieldIdentifiers(collection.fields, { collectionSlug: collection.slug }));

  return errors;
}

export function validateGlobalIdentifiers(
  global: Pick<GlobalDefinition, 'slug' | 'fields'>
): string[] {
  const errors: string[] = [];

  if (!isValidIdentifier(global.slug)) {
    errors.push(
      `Global slug "${global.slug}" is not a valid identifier. ` +
        `It must match ${IDENTIFIER_PATTERN.source}.`
    );
  }

  errors.push(...validateFieldIdentifiers(global.fields, { collectionSlug: global.slug }));

  return errors;
}

export { IDENTIFIER_PATTERN };
