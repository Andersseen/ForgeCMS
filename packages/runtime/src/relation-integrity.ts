import type {
  CmsUser,
  CollectionDefinition,
  RelationFieldOptions,
  UploadFieldOptions
} from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { assertNotAuthManaged, isAuthManagedCollection } from './auth-managed.js';
import { InvalidInputError } from './errors.js';
import { versionsEnabled } from './versions.js';

/**
 * Low-level relation integrity helpers (restrict / cascade / set-null on delete), kept as public
 * `@forge-cms/runtime` exports.
 *
 * **Since spec 064 `runtime.delete()` does not use the mutating helpers here.** It plans the whole
 * cascade/set-null/restrict graph with reads only and commits it as one atomic batch
 * (`relation-lifecycle.ts` + `operations.ts`). `handleCascadeDelete`/`handleSetNullOnDelete` still work as
 * before (spec 058: through a caller-supplied {@link RelationMutator}, or raw adapter writes without one),
 * but each of their writes commits on its own — a later failure leaves earlier ones in place, and a
 * reference created concurrently is not detected. Use `runtime.delete()` for guarantees.
 */

export interface RelationMutator {
  deleteDocument(args: {
    collection: string;
    id: string;
    user?: CmsUser | null;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
    user?: CmsUser | null;
    overrideAccess?: boolean;
  }): Promise<unknown>;
}

export interface RelationIntegrityOptions {
  /**
   * Routes dependent mutations through the real Local API pipeline instead of a raw adapter write.
   * Omitted = raw `ctx.adapters.database.delete()`/`.update()` calls (the pre-058 behavior, kept for
   * direct/advanced callers) — `operations.ts`'s `deleteDocument` always supplies one.
   */
  mutator?: RelationMutator;
  /** Attributed to dependent mutations (hooks/audit) when a mutator is supplied. */
  user?: CmsUser | null;
  /**
   * Cycle/self-relation/diamond-reference guard shared across one whole cascade+set-null traversal —
   * every processed `"collection:id"` is added here before it is mutated, so a reference cycle cannot
   * be revisited and a document reachable by two different cascade paths is only ever mutated once.
   * Callers normally omit this; `operations.ts`'s `deleteDocument` seeds and threads one through.
   */
  visited?: Set<string>;
}

/**
 * The raw-adapter fallback used when a caller invokes `handleCascadeDelete`/`handleSetNullOnDelete`
 * directly, without a `mutator` — a low-level primitive, but still a `@forge-cms/runtime` public export,
 * not the raw `DatabaseAdapter` escape hatch itself. The boundary (spec 061) applies here too: it would
 * otherwise be a second, undocumented generic-write path into a managed collection, reachable without
 * ever going through `operations.ts`. `operations.ts`'s own `deleteDocumentInternal` always supplies a
 * real mutator (backed by its own `deleteDocumentInternal`/`update`, already guarded), so this only
 * changes behavior for a caller using the raw fallback on purpose.
 */
function defaultMutator(ctx: OperationContext): RelationMutator {
  return {
    deleteDocument: (args) => {
      assertNotAuthManaged(ctx, args.collection);
      return ctx.adapters.database.delete(args.collection, args.id);
    },
    update: (args) => {
      assertNotAuthManaged(ctx, args.collection);
      // A raw write to a versioned document would commit a change with no version row, silently
      // breaking the version-number serialization every versioned update relies on (spec 062 §3).
      const target = ctx.getCollection(args.collection);
      if (target && versionsEnabled(target)) {
        throw new Error(
          `Collection '${args.collection}' has versions enabled; pass a mutator backed by the runtime's ` +
            `update() so the change and its version snapshot are written together (spec 062).`
        );
      }
      return ctx.adapters.database.update(args.collection, args.id, args.data);
    }
  };
}

/**
 * Finds all relation fields in a collection that reference a target collection. Includes
 * self-relations (`collection === targetCollection`) — spec 058 §5 removed the previous same-collection
 * skip, which silently let a self-relation's `onDelete` go unenforced entirely.
 */
export function findRelationFields(
  collection: CollectionDefinition,
  targetCollection: string
): Array<{ fieldName: string; options: RelationFieldOptions }> {
  const relations: Array<{ fieldName: string; options: RelationFieldOptions }> = [];

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (field.kind === 'relation') {
      const options = field.options as RelationFieldOptions;
      if (options.collection === targetCollection) {
        relations.push({ fieldName, options });
      }
    }
  }

  return relations;
}

/**
 * Finds all documents in a collection that reference a specific document ID. The many-relation branch
 * uses the `containsValue` operator (spec 050, every adapter) for a real database-side membership
 * query instead of an unconditional full-table scan filtered in JavaScript (spec 058 §5).
 */
export async function findReferencingDocuments(
  ctx: OperationContext,
  collection: CollectionDefinition,
  fieldName: string,
  documentId: string,
  many: boolean
): Promise<DatabaseRecord[]> {
  if (many) {
    return ctx.adapters.database.findMany({
      collection: collection.slug,
      where: { [fieldName]: { containsValue: documentId } }
    });
  }
  return ctx.adapters.database.findMany({
    collection: collection.slug,
    where: { [fieldName]: documentId }
  });
}

/**
 * @deprecated Since spec 064 `runtime.delete()` checks restrictions against the final state of its
 * whole plan, inside one atomic batch; this one-level, read-only pre-check remains for direct callers.
 *
 * Checks if a document can be deleted based on relation constraints. Throws {@link InvalidInputError}
 * — before any mutation happens — if deletion is restricted, or if a `set-null` relation targets a
 * `required: true` field that has live references: a null value can never satisfy a required field, so
 * this is treated the same as `restrict` rather than failing deep inside a partially-completed cascade
 * with a generic validation error (spec 058 §5's required-field-on-set-null guard).
 *
 * The same applies to a `cascade`/`set-null` relation whose dependent collection is managed by the
 * auth adapter (spec 061): the cascade would be a generic write into that collection, which the runtime
 * refuses for everyone, so it is rejected here — before any mutation, with a message about the document
 * being deleted rather than about the managed collection — instead of failing part-way through.
 *
 * There is deliberately no supported way to clear the reference and retry: the auth adapter's own
 * `updateUser` only accepts email/name/role/password, not an arbitrary custom field, so this rejection
 * is not "remove the reference, then delete" advice — see the error message, and spec 061 §7/Non-goals.
 * The only way past it is the documented raw `DatabaseAdapter` escape hatch (outside runtime guarantees).
 */
export async function checkDeleteRestrictions(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string
): Promise<void> {
  for (const collection of ctx.getCollections()) {
    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';
      const unsafeRequiredSetNull = onDelete === 'set-null' && options.required === true;
      const authManagedDependent =
        onDelete !== 'restrict' && isAuthManagedCollection(ctx, collection.slug);
      if (onDelete !== 'restrict' && !unsafeRequiredSetNull && !authManagedDependent) continue;

      const referencing = await findReferencingDocuments(
        ctx,
        collection,
        fieldName,
        documentId,
        options.many ?? false
      );

      if (referencing.length === 0) continue;

      if (authManagedDependent) {
        throw new InvalidInputError(
          `Cannot delete document '${documentId}' from '${targetCollection.slug}': ` +
            `${referencing.length} document(s) in '${collection.slug}' reference it with ` +
            `onDelete '${onDelete}', but '${collection.slug}' is managed by the configured auth adapter, ` +
            `so a relation cascade cannot change it. Clearing the reference on those document(s) is not ` +
            `possible through generic collection CRUD or the auth adapter's user-management operations; ` +
            `it requires direct database access, which is outside runtime guarantees`
        );
      }

      if (unsafeRequiredSetNull) {
        throw new InvalidInputError(
          `Cannot delete document '${documentId}' from '${targetCollection.slug}': field '${fieldName}' ` +
            `on '${collection.slug}' is required and configured 'onDelete: set-null', which cannot ` +
            `satisfy ${referencing.length} referencing document(s) without violating that requirement`
        );
      }

      throw new InvalidInputError(
        `Cannot delete document '${documentId}' from '${targetCollection.slug}': ` +
          `referenced by ${referencing.length} document(s) in '${collection.slug}'`
      );
    }
  }
}

/**
 * @deprecated Not atomic — each dependent delete commits on its own. `runtime.delete()` (spec 064)
 * commits the whole cascade graph in one batch and no longer calls this.
 *
 * Handles cascade delete: deletes all documents that reference the deleted document. With a real
 * mutator supplied, each dependent delete recurses through the full delete pipeline (its own
 * `checkDeleteRestrictions`/cascade/set-null included) — so a cascade chain several levels deep is
 * fully processed, not just one level. Not transactional: if a later step fails (a second-level
 * `restrict`, a hook throwing, a DB error), documents already deleted by earlier steps stay deleted —
 * the current `DatabaseAdapter` contract has no cross-document transaction to roll back with, and this
 * matches the pre-058 code's identical (if previously undocumented) property.
 */
export async function handleCascadeDelete(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string,
  integrityOptions: RelationIntegrityOptions = {}
): Promise<void> {
  const mutator = integrityOptions.mutator ?? defaultMutator(ctx);
  const visited = integrityOptions.visited ?? new Set<string>();
  const user = integrityOptions.user ?? null;

  for (const collection of ctx.getCollections()) {
    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';
      if (onDelete !== 'cascade') continue;

      const referencing = await findReferencingDocuments(
        ctx,
        collection,
        fieldName,
        documentId,
        options.many ?? false
      );

      for (const doc of referencing) {
        const key = `${collection.slug}:${doc.id as string}`;
        // Already deleted (or in progress) via another cascade path, or a reference cycle — do not
        // reprocess or recurse forever.
        if (visited.has(key)) continue;
        visited.add(key);

        await mutator.deleteDocument({
          collection: collection.slug,
          id: doc.id as string,
          overrideAccess: true,
          ...(user !== null && { user })
        });
      }
    }
  }
}

/**
 * @deprecated Not atomic — each update commits on its own. `runtime.delete()` (spec 064) commits its
 * set-null updates in the same batch as the delete and no longer calls this.
 *
 * Handles set-null: sets relation fields to null (or removes the id from a many-relation array) in
 * all referencing documents. Skips a document already processed elsewhere in this same delete
 * operation (cascade-deleted, or already set-null'd via another field/path) via the shared `visited`
 * set — including the case of a self-relation pointing a document at itself, which would otherwise try
 * to update a row that is itself mid-deletion.
 */
export async function handleSetNullOnDelete(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string,
  integrityOptions: RelationIntegrityOptions = {}
): Promise<void> {
  const mutator = integrityOptions.mutator ?? defaultMutator(ctx);
  const visited = integrityOptions.visited ?? new Set<string>();
  const user = integrityOptions.user ?? null;

  for (const collection of ctx.getCollections()) {
    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';
      if (onDelete !== 'set-null') continue;

      const referencing = await findReferencingDocuments(
        ctx,
        collection,
        fieldName,
        documentId,
        options.many ?? false
      );

      for (const doc of referencing) {
        const key = `${collection.slug}:${doc.id as string}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const newValue: unknown = options.many
          ? ((doc[fieldName] as string[] | undefined) ?? []).filter((id) => id !== documentId)
          : null;

        await mutator.update({
          collection: collection.slug,
          id: doc.id as string,
          data: { [fieldName]: newValue },
          overrideAccess: true,
          ...(user !== null && { user })
        });
      }
    }
  }
}

/**
 * Finds orphaned documents: documents whose top-level `relation` or `upload` field points at a document
 * that does not exist. Diagnostic only — nothing is repaired. Since spec 064 a successfully committed
 * supported write or delete cannot create one; orphans found here predate it, or were written through
 * the raw `DatabaseAdapter` or the auth adapter's user lifecycle.
 */
export async function findOrphanedDocuments(
  ctx: OperationContext,
  collection: CollectionDefinition
): Promise<Array<{ document: DatabaseRecord; fieldName: string; missingId: string }>> {
  const orphans: Array<{ document: DatabaseRecord; fieldName: string; missingId: string }> = [];
  const allDocs = await ctx.adapters.database.findMany({ collection: collection.slug });

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (field.kind !== 'relation' && field.kind !== 'upload') continue;

    const options = field.options as RelationFieldOptions | UploadFieldOptions;
    const targetCollection = options.collection;
    const many = field.kind === 'relation' && (options as RelationFieldOptions).many === true;

    for (const doc of allDocs) {
      const value = doc[fieldName];

      if (many && Array.isArray(value)) {
        // Check each ID in the array
        for (const id of value) {
          if (typeof id === 'string') {
            const target = await ctx.adapters.database.findById(targetCollection, id);
            if (!target) {
              orphans.push({ document: doc, fieldName, missingId: id });
            }
          }
        }
      } else if (typeof value === 'string') {
        // Check single relation
        const target = await ctx.adapters.database.findById(targetCollection, value);
        if (!target) {
          orphans.push({ document: doc, fieldName, missingId: value });
        }
      }
    }
  }

  return orphans;
}
