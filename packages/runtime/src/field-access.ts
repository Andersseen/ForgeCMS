import type { CmsUser, CollectionDefinition } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import { resolveFieldAccess } from './access.js';

export class FieldAccessError extends Error {
  constructor(readonly field: string) {
    super(`Forbidden: cannot set field '${field}'`);
  }
}

/**
 * Omits fields the user may not read (`field.options.access.read`). A rule can now be a predicate as
 * well as a role list (spec 020), so resolution is async.
 */
export async function filterReadableFields(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  user: CmsUser | null
): Promise<DatabaseRecord> {
  const filtered: DatabaseRecord = {};
  for (const [key, value] of Object.entries(record)) {
    const field = collection.fields[key];
    if (field) {
      const allowed = await resolveFieldAccess(field.options.access?.read, {
        user,
        operation: 'read',
        collection,
        fieldName: key,
        doc: record
      });
      if (!allowed) continue;
    }
    filtered[key] = value;
  }
  return filtered;
}

/** Throws {@link FieldAccessError} naming the first field the user may not write. */
export async function assertWritableFields(
  body: Record<string, unknown>,
  collection: CollectionDefinition,
  user: CmsUser | null,
  operation: 'create' | 'update' = 'create'
): Promise<void> {
  for (const key of Object.keys(body)) {
    const field = collection.fields[key];
    if (!field) continue;

    const allowed = await resolveFieldAccess(field.options.access?.write, {
      user,
      operation,
      collection,
      fieldName: key,
      data: body
    });
    if (!allowed) throw new FieldAccessError(key);
  }
}
