import { defineField } from '@forge-cms/core';
import type { CollectionDefinition, FieldMap } from '@forge-cms/core';

/**
 * The fields `UsersCollectionAuthAdapter` writes to but that a hand-written `users` collection has no
 * reason to declare. On a schemaless adapter (in-memory) an undeclared column is harmless; on a real
 * SQL adapter (D1/LibSQL) `generateCreateTableSql` never creates the column and the INSERT fails with
 * `table users has no column named passwordHash`. Registering them makes the auth adapter's storage
 * needs part of the collection definition, so schema generation and migration cover them.
 *
 * `access.read: []` means "no role may read this" — `filterReadableFields` strips `passwordHash` from
 * every API response even if a caller adds it to the collection by hand.
 */
export const AUTH_USER_FIELDS = {
  passwordHash: defineField.text({ access: { read: [], write: [] } })
} satisfies FieldMap;

/**
 * Returns the collection with the auth adapter's own fields merged in. Explicit fields win, so a
 * caller that already declares `passwordHash` keeps their definition.
 */
export function withAuthFields<TSlug extends string, TFields extends FieldMap>(
  collection: CollectionDefinition<TSlug, TFields>
): CollectionDefinition<TSlug, TFields & typeof AUTH_USER_FIELDS> {
  return {
    ...collection,
    fields: { ...AUTH_USER_FIELDS, ...collection.fields } as TFields & typeof AUTH_USER_FIELDS
  };
}
