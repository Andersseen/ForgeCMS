const IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

const SYSTEM_FIELD_NAMES = new Set(['id', 'created_at', 'updated_at', '_status']);

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name);
}

export function assertValidIdentifier(name: string, context: string): void {
  if (!isValidIdentifier(name)) {
    throw new Error(
      `Invalid identifier "${name}" in ${context}. ` +
        `Identifiers must match ${IDENTIFIER_PATTERN.source} (start with a lowercase letter, ` +
        `contain only letters, digits, and underscores).`
    );
  }
}

export function isSystemField(name: string): boolean {
  return SYSTEM_FIELD_NAMES.has(name);
}

export function getSystemFields(): ReadonlySet<string> {
  return SYSTEM_FIELD_NAMES;
}

export function validateCollectionIdentifiers(collection: {
  slug: string;
  fields: Record<string, unknown>;
}): string[] {
  const errors: string[] = [];

  if (!isValidIdentifier(collection.slug)) {
    errors.push(
      `Collection slug "${collection.slug}" is not a valid identifier. ` +
        `It must match ${IDENTIFIER_PATTERN.source}.`
    );
  }

  for (const fieldName of Object.keys(collection.fields)) {
    if (!isValidIdentifier(fieldName)) {
      errors.push(
        `Field name "${fieldName}" in collection "${collection.slug}" is not a valid identifier. ` +
          `It must match ${IDENTIFIER_PATTERN.source}.`
      );
    }
    if (SYSTEM_FIELD_NAMES.has(fieldName)) {
      errors.push(
        `Field name "${fieldName}" in collection "${collection.slug}" conflicts with a system field.`
      );
    }
  }

  return errors;
}

export { IDENTIFIER_PATTERN };
