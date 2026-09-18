import type { CmsUser, CollectionDefinition, Version } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { NotFoundError } from './errors.js';
import { documentMatches } from './access.js';
import { checkAccess, statusConstraint } from './read-policy.js';
import { filterReadableFields } from './field-access.js';

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
 * A version's history must not tell an untrusted caller anything about its owning document that the
 * document's own read policy wouldn't already tell them (spec 058 §2 / maintainer brief §2). This
 * mirrors `findByID`'s own owner-lookup: collection-level denial surfaces as `403` (matching a normal
 * denied read), a missing owner or a row/draft mismatch surfaces as `404` (never confirms whether a
 * hidden document exists), exactly like `findByID` already behaves for a single document by id.
 *
 * Only called when `overrideAccess === false` — a trusted Local API call skips this entirely, same as
 * every other operation's `overrideAccess: true` default.
 */
async function assertOwnerReadable(
  ctx: OperationContext,
  collection: CollectionDefinition,
  documentId: string,
  user: CmsUser | null
): Promise<void> {
  const owner = await ctx.adapters.database.findById(collection.slug, documentId);
  if (!owner) throw new NotFoundError(`Document '${documentId}' not found`);

  const decision = await checkAccess(collection, 'read', {
    user,
    overrideAccess: false,
    id: documentId,
    doc: owner
  });
  if (decision.where && !documentMatches(owner, decision.where)) {
    throw new NotFoundError(`Document '${documentId}' not found`);
  }

  // Matches `findByID`'s own default: a single document known by id is visible to any authenticated
  // caller regardless of draft status; anonymous callers only ever see published documents.
  const status = statusConstraint(collection, undefined, user, false, 'all');
  if (status && !documentMatches(owner, status)) {
    throw new NotFoundError(`Document '${documentId}' not found`);
  }
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

  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  if (!overrideAccess) {
    await assertOwnerReadable(ctx, collection, args.documentId, user);
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

  const versions = records.map(toVersion);
  if (overrideAccess) return versions;

  return Promise.all(
    versions.map(async (version) => ({
      ...version,
      data: await filterReadableFields(version.data, collection, user)
    }))
  );
}

/**
 * Gets a specific version by id. `overrideAccess: true` (the default, matching every other Local API
 * method) returns the raw, unfiltered snapshot with no owner-visibility check — used internally by
 * {@link import('./operations.js').restoreVersion}, where the authoritative access gate is the
 * subsequent `update()` call, not this read.
 */
export async function getVersion(ctx: OperationContext, args: GetVersionArgs): Promise<Version> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  const versionsCollection = `_versions_${args.collection}`;
  const record = await ctx.adapters.database.findById(versionsCollection, args.versionId);
  if (!record) throw new NotFoundError(`Version '${args.versionId}' not found`);

  const version = toVersion(record);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  if (overrideAccess) return version;

  await assertOwnerReadable(ctx, collection, version.documentId, user);
  return { ...version, data: await filterReadableFields(version.data, collection, user) };
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
