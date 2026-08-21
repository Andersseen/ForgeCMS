import type { CmsUser, CollectionDefinition, Version } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { NotFoundError } from './errors.js';

export interface ListVersionsArgs {
  collection: string;
  documentId: string;
  user?: CmsUser | null;
  overrideAccess?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetVersionArgs {
  collection: string;
  versionId: string;
  user?: CmsUser | null;
  overrideAccess?: boolean;
}

export interface RestoreVersionArgs {
  collection: string;
  versionId: string;
  user?: CmsUser | null;
  overrideAccess?: boolean;
}

export interface CreateVersionArgs {
  collection: string;
  documentId: string;
  data: Record<string, unknown>;
  user?: CmsUser | null;
  autosave?: boolean;
  label?: string;
}

function getCollectionOrThrow(ctx: OperationContext, slug: string): CollectionDefinition {
  const collection = ctx.getCollection(slug);
  if (!collection) throw new NotFoundError(`Collection '${slug}' not found`);
  return collection;
}

function versionsEnabled(collection: CollectionDefinition): boolean {
  return (
    collection.versions === true ||
    (typeof collection.versions === 'object' && collection.versions !== null)
  );
}

function autosaveEnabled(collection: CollectionDefinition): boolean {
  if (typeof collection.versions === 'object' && collection.versions !== null) {
    return collection.versions.autosave === true;
  }
  return false;
}

/**
 * Lists all versions of a document, newest first.
 */
export async function listVersions(
  ctx: OperationContext,
  args: ListVersionsArgs
): Promise<Version[]> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const versionsCollection = `_versions_${args.collection}`;
  const records = await ctx.adapters.database.findMany({
    collection: versionsCollection,
    where: { documentId: args.documentId },
    sort: 'versionNumber',
    order: 'desc',
    ...(args.limit !== undefined && { limit: args.limit }),
    ...(args.offset !== undefined && { offset: args.offset })
  });

  return records.map(toVersion);
}

/**
 * Gets a specific version by id.
 */
export async function getVersion(ctx: OperationContext, args: GetVersionArgs): Promise<Version> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const versionsCollection = `_versions_${args.collection}`;
  const record = await ctx.adapters.database.findById(versionsCollection, args.versionId);
  if (!record) throw new NotFoundError(`Version '${args.versionId}' not found`);

  return toVersion(record);
}

/**
 * Restores a document to a specific version. Creates a new version with the restored data.
 */
export async function restoreVersion(
  ctx: OperationContext,
  args: RestoreVersionArgs
): Promise<DatabaseRecord> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const version = await getVersion(ctx, {
    collection: args.collection,
    versionId: args.versionId,
    ...(args.user !== undefined && { user: args.user }),
    ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess })
  });

  // Update the document with the version data
  const record = await ctx.adapters.database.update(
    args.collection,
    version.documentId,
    version.data
  );

  // Create a new version for the restore
  await createVersion(ctx, {
    collection: args.collection,
    documentId: version.documentId,
    data: version.data,
    ...(args.user !== undefined && { user: args.user }),
    label: `Restored from version ${version.versionNumber}`
  });

  return record;
}

/**
 * Creates a new version of a document. Called automatically on updates when versions are enabled.
 */
export async function createVersion(
  ctx: OperationContext,
  args: CreateVersionArgs
): Promise<Version> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const versionsCollection = `_versions_${args.collection}`;

  // Get the latest version number for this document
  const existingVersions = await ctx.adapters.database.findMany({
    collection: versionsCollection,
    where: { documentId: args.documentId },
    sort: 'versionNumber',
    order: 'desc',
    limit: 1
  });

  const lastVersionNumber =
    existingVersions.length > 0 ? ((existingVersions[0]?.versionNumber as number) ?? 0) : 0;

  const versionRecord: DatabaseRecord = {
    id: crypto.randomUUID(),
    documentId: args.documentId,
    versionNumber: lastVersionNumber + 1,
    data: JSON.stringify(args.data),
    createdAt: new Date().toISOString(),
    createdBy: args.user?.id ?? null,
    autosave: args.autosave ?? false,
    ...(args.label !== undefined && { label: args.label })
  };

  const created = await ctx.adapters.database.create(versionsCollection, versionRecord);
  return toVersion(created);
}

function toVersion(record: DatabaseRecord): Version {
  const data = typeof record.data === 'string' ? JSON.parse(record.data) : record.data;

  return {
    id: record.id as string,
    documentId: record.documentId as string,
    versionNumber: record.versionNumber as number,
    data: data as Record<string, unknown>,
    createdAt: record.createdAt as string,
    createdBy: (record.createdBy as string) ?? null,
    autosave: (record.autosave as boolean) ?? false,
    ...(record.label !== undefined && { label: record.label as string })
  };
}

export { versionsEnabled, autosaveEnabled };
