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
