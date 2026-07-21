import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { UserRole } from '@forge-cms/auth';

export class FieldAccessError extends Error {
  constructor(readonly field: string) {
    super(`Forbidden: cannot set field '${field}'`);
  }
}

function isAllowed(allowedRoles: string[] | undefined, role: UserRole | undefined): boolean {
  if (!allowedRoles) return true;
  if (!role) return false;
  return (allowedRoles as string[]).includes(role);
}

/** Omit fields the given role isn't allowed to read (per field.options.access.read). */
export function filterReadableFields(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  role: UserRole | undefined
): DatabaseRecord {
  const filtered: DatabaseRecord = {};
  for (const [key, value] of Object.entries(record)) {
    const field = collection.fields[key];
    if (field && !isAllowed(field.options.access?.read, role)) continue;
    filtered[key] = value;
  }
  return filtered;
}

/** Throws FieldAccessError naming the first field the given role isn't allowed to write. */
export function assertWritableFields(
  body: Record<string, unknown>,
  collection: CollectionDefinition,
  role: UserRole | undefined
): void {
  for (const key of Object.keys(body)) {
    const field = collection.fields[key];
    if (field && !isAllowed(field.options.access?.write, role)) {
      throw new FieldAccessError(key);
    }
  }
}
