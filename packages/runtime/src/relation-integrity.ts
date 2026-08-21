import type { CollectionDefinition, RelationFieldOptions } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { InvalidInputError } from './errors.js';

/**
 * Relation integrity utilities for handling cascade, restrict, and set-null on delete.
 */

/**
 * Finds all relation fields in a collection that reference a target collection.
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
 * Finds all documents in a collection that reference a specific document ID.
 */
export async function findReferencingDocuments(
  ctx: OperationContext,
  collection: CollectionDefinition,
  fieldName: string,
  documentId: string,
  many: boolean
): Promise<DatabaseRecord[]> {
  if (many) {
    // For many relations, we need to check if the ID is in the array
    const allDocs = await ctx.adapters.database.findMany({ collection: collection.slug });
    return allDocs.filter((doc) => {
      const value = doc[fieldName];
      return Array.isArray(value) && value.includes(documentId);
    });
  } else {
    // For single relations, use where clause
    return ctx.adapters.database.findMany({
      collection: collection.slug,
      where: { [fieldName]: documentId }
    });
  }
}

/**
 * Checks if a document can be deleted based on relation constraints.
 * Throws InvalidInputError if deletion is restricted.
 */
export async function checkDeleteRestrictions(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string
): Promise<void> {
  // Check all collections for relations to this collection
  for (const collection of ctx.getCollections()) {
    if (collection.slug === targetCollection.slug) continue;

    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';

      if (onDelete === 'restrict') {
        const referencing = await findReferencingDocuments(
          ctx,
          collection,
          fieldName,
          documentId,
          options.many ?? false
        );

        if (referencing.length > 0) {
          throw new InvalidInputError(
            `Cannot delete document '${documentId}' from '${targetCollection.slug}': ` +
              `referenced by ${referencing.length} document(s) in '${collection.slug}'`
          );
        }
      }
    }
  }
}

/**
 * Handles cascade delete: deletes all documents that reference the deleted document.
 */
export async function handleCascadeDelete(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string
): Promise<void> {
  for (const collection of ctx.getCollections()) {
    if (collection.slug === targetCollection.slug) continue;

    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';

      if (onDelete === 'cascade') {
        const referencing = await findReferencingDocuments(
          ctx,
          collection,
          fieldName,
          documentId,
          options.many ?? false
        );

        // Delete all referencing documents
        for (const doc of referencing) {
          await ctx.adapters.database.delete(collection.slug, doc.id as string);
        }
      }
    }
  }
}

/**
 * Handles set-null: sets relation fields to null in all referencing documents.
 */
export async function handleSetNullOnDelete(
  ctx: OperationContext,
  targetCollection: CollectionDefinition,
  documentId: string
): Promise<void> {
  for (const collection of ctx.getCollections()) {
    if (collection.slug === targetCollection.slug) continue;

    const relations = findRelationFields(collection, targetCollection.slug);

    for (const { fieldName, options } of relations) {
      const onDelete = options.onDelete ?? 'restrict';

      if (onDelete === 'set-null') {
        const referencing = await findReferencingDocuments(
          ctx,
          collection,
          fieldName,
          documentId,
          options.many ?? false
        );

        // Update each referencing document
        for (const doc of referencing) {
          if (options.many) {
            // Remove the ID from the array
            const currentValue = doc[fieldName] as string[];
            const newValue = currentValue.filter((id) => id !== documentId);
            await ctx.adapters.database.update(collection.slug, doc.id as string, {
              [fieldName]: newValue
            });
          } else {
            // Set to null
            await ctx.adapters.database.update(collection.slug, doc.id as string, {
              [fieldName]: null
            });
          }
        }
      }
    }
  }
}

/**
 * Finds orphaned documents: documents with relation fields pointing to non-existent documents.
 */
export async function findOrphanedDocuments(
  ctx: OperationContext,
  collection: CollectionDefinition
): Promise<Array<{ document: DatabaseRecord; fieldName: string; missingId: string }>> {
  const orphans: Array<{ document: DatabaseRecord; fieldName: string; missingId: string }> = [];
  const allDocs = await ctx.adapters.database.findMany({ collection: collection.slug });

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (field.kind !== 'relation') continue;

    const options = field.options as RelationFieldOptions;
    const targetCollection = options.collection;

    for (const doc of allDocs) {
      const value = doc[fieldName];

      if (options.many && Array.isArray(value)) {
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
