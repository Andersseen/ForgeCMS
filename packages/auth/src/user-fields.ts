import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition, FieldMap } from '@forge-cms/core';
import { isAdmin } from './roles.js';

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
 *
 * `collection.fields` is spread first, `AUTH_USER_FIELDS` second, so `passwordHash` lands *after*
 * every field a caller actually declared (email, name, role, ...) instead of before all of them —
 * object key order follows first insertion, and `passwordHash` failing to be a caller's first field
 * is not just cosmetic: `@forge-cms/admin`'s `ForgeRelationPickerComponent` picks "the target
 * collection's first text-ish field" as what it searches on, so a `relation({ collection: 'users' })`
 * field silently searched by password hash instead of email until this fix (found building spec 055's
 * external-consumer fixture, whose `post.author -> users` relation is exactly this shape).
 */
export function withAuthFields<TSlug extends string, TFields extends FieldMap>(
  collection: CollectionDefinition<TSlug, TFields>
): CollectionDefinition<TSlug, TFields & typeof AUTH_USER_FIELDS> {
  const hasOwnPasswordHash = 'passwordHash' in collection.fields;
  const fields = {
    ...collection.fields,
    ...(!hasOwnPasswordHash && AUTH_USER_FIELDS)
  } as TFields & typeof AUTH_USER_FIELDS;
  return {
    ...collection,
    fields
  };
}

const RECOMMENDED_USER_FIELDS = {
  email: defineField.email({ required: true, unique: true }),
  name: defineField.text(),
  // No `access.write` restriction here would let the collection-level `update` rule's self-service
  // grant (below) double as a privilege-escalation path: a plain viewer could `PATCH` their own
  // record's `role` to `admin` through the generic collection route, exactly what `signup()`'s
  // role-free input type exists to prevent. Only an admin may write this field; anyone permitted to
  // read the record (see `access.read` below) may still read it.
  role: defineField.select({
    options: ['admin', 'editor', 'viewer'],
    defaultValue: 'viewer',
    access: { write: ['admin'] }
  })
} satisfies FieldMap;

export interface DefineUsersCollectionOptions {
  /** Defaults to `'users'`. */
  slug?: string;
}

/**
 * The recommended `users` collection shape for `UsersCollectionAuthAdapter`: a required, unique
 * `email`, a `role` select (`admin | editor | viewer`, defaulting to `viewer`), an optional `name`, and
 * `passwordHash` via {@link withAuthFields}. The unique `email` index is what makes
 * `UsersCollectionAuthAdapter`'s signup/`createUser` race-safe against a duplicate email under
 * concurrent writes (see `UniqueConstraintError` handling there) — a hand-rolled `users` collection
 * without it only gets the adapter's non-atomic pre-check.
 *
 * Opinionated, not mandatory: a consumer that already declares its own `users` collection (extra
 * fields like `avatar`/`status`, different defaults) can keep using {@link withAuthFields} directly
 * instead. Ships with sensible default access — any authenticated user may read the list and update
 * their own record (e.g. their name or password via `updateUser`); only an admin may create, update
 * any record, or delete.
 */
export function defineUsersCollection(
  options: DefineUsersCollectionOptions = {}
): CollectionDefinition<string, typeof RECOMMENDED_USER_FIELDS & typeof AUTH_USER_FIELDS> {
  return withAuthFields(
    defineCollection({
      slug: options.slug ?? 'users',
      fields: RECOMMENDED_USER_FIELDS,
      access: {
        read: ({ user }) => user !== null,
        create: ({ user }) => isAdmin(user),
        update: ({ user }) => (isAdmin(user) ? true : user ? { id: user.id } : false),
        delete: ({ user }) => isAdmin(user)
      }
    })
  );
}
