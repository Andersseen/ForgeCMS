import { defineField } from '@forge-cms/core';
import type { AnyField, CmsUser, CollectionDefinition, Version } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import { isUniqueConstraintError as isDbUniqueConstraintError } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { ConcurrentModificationError, NotFoundError } from './errors.js';
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

/**
 * Whether `versions: { autosave: true }` is set. Nothing in the runtime acts on it today (spec 062 §11):
 * automatic snapshots are always `autosave: false`; only a manual `createVersion({ autosave: true })`
 * sets the flag.
 */
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

/** Attempts (in total) manual {@link createVersion} makes to allocate a version number under contention. */
const MAX_MANUAL_VERSION_ATTEMPTS = 3;

/**
 * Creates a version of a document by hand (trusted Local API only — there is no HTTP route). Stores
 * `data` verbatim: no hooks, no access check, no check that the owner document still exists, and — since
 * nothing guarantees the caller passed full content — the row is not marked as a full snapshot, so a
 * restore of it only applies the fields it contains (spec 062 §7).
 *
 * The version number is `latest + 1`, made safe by the unique `(documentId, versionNumber)` index: when
 * another writer takes that number first, the latest is re-read and the insert retried, at most
 * {@link MAX_MANUAL_VERSION_ATTEMPTS} times in total, then {@link ConcurrentModificationError}. Retrying
 * is safe here — and only here — because nothing but the number changes between attempts: no document
 * write, no consumer code. Automatic snapshots are not created through this function; see
 * `operations.ts`, which writes them in the same atomic batch as the document.
 */
export async function createVersion(
  ctx: OperationContext,
  args: CreateVersionArgs
): Promise<Version> {
  const collection = getCollectionOrThrow(ctx, args.collection);
  if (!versionsEnabled(collection)) {
    throw new Error(`Collection '${args.collection}' does not have versions enabled`);
  }

  for (let attempt = 1; ; attempt++) {
    const latest = await readLatestVersionNumber(
      ctx.adapters.database,
      collection,
      args.documentId
    );
    const record = buildVersionRecord({
      documentId: args.documentId,
      versionNumber: latest + 1,
      data: args.data,
      user: args.user ?? null,
      full: false,
      ...(args.autosave !== undefined && { autosave: args.autosave }),
      ...(args.label !== undefined && { label: args.label })
    });

    try {
      const created = await ctx.adapters.database.create(
        versionsCollectionSlug(collection.slug),
        record
      );
      return toVersion(created);
    } catch (err) {
      if (!isVersionIdentityConflict(err, collection)) throw err;
      if (attempt >= MAX_MANUAL_VERSION_ATTEMPTS) {
        throw new ConcurrentModificationError(collection.slug, args.documentId);
      }
    }
  }
}

// --- spec 062: version table, full snapshots, restore diff ---------------------------------------

/** Marker stored in `snapshotFormat` on every automatic snapshot written since spec 062. */
const FULL_SNAPSHOT = 'full';

/** Adapter/system metadata — never part of restorable content (spec 062 §5). */
const SYSTEM_KEYS = new Set(['id', 'created_at', 'updated_at', '_storageKey']);

export function versionsCollectionSlug(collectionSlug: string): string {
  return `_versions_${collectionSlug}`;
}

/**
 * The internal collection that stores a versioned collection's history. The compound unique
 * `(documentId, versionNumber)` index is the version-identity invariant every automatic write relies
 * on for serialization (spec 062 §1/§3); `snapshotFormat` tells a full snapshot from a pre-062 patch.
 */
export function versionCollectionDefinition(collectionSlug: string): CollectionDefinition {
  const fields: Record<string, AnyField> = {
    documentId: defineField.text({ required: true }),
    versionNumber: defineField.number({ required: true }),
    data: defineField.json({ required: true }),
    createdAt: defineField.date({ required: true }),
    createdBy: defineField.text(),
    autosave: defineField.boolean(),
    label: defineField.text(),
    snapshotFormat: defineField.text()
  };
  return {
    slug: versionsCollectionSlug(collectionSlug),
    fields,
    indexes: [{ fields: ['documentId', 'versionNumber'], unique: true }]
  };
}

/** Whether `err` is the version table's `(documentId, versionNumber)` unique index rejecting a write. */
export function isVersionIdentityConflict(err: unknown, collection: CollectionDefinition): boolean {
  return (
    isDbUniqueConstraintError(err) && err.collection === versionsCollectionSlug(collection.slug)
  );
}

/** The highest committed version number of a document, `0` when it has none. */
export async function readLatestVersionNumber(
  database: DatabaseAdapter,
  collection: CollectionDefinition,
  documentId: string
): Promise<number> {
  const [latest] = await database.findMany({
    collection: versionsCollectionSlug(collection.slug),
    where: { documentId },
    sort: 'versionNumber',
    order: 'desc',
    limit: 1
  });
  const value = latest?.versionNumber;
  return typeof value === 'number' ? value : 0;
}

/**
 * The restorable content of a document (spec 062 §5): every field the collection declares — `null`
 * when unset, so restoring can clear it — plus `_status` on a drafts collection. Never `id`,
 * timestamps, `_storageKey` or undeclared keys.
 */
export function buildSnapshot(
  collection: CollectionDefinition,
  content: Record<string, unknown>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const name of Object.keys(collection.fields)) {
    snapshot[name] = content[name] ?? null;
  }
  if (collection.drafts === true && content._status !== undefined) {
    snapshot._status = content._status;
  }
  return snapshot;
}

export function buildVersionRecord(input: {
  documentId: string;
  versionNumber: number;
  data: Record<string, unknown>;
  user: CmsUser | null;
  /** `true` for automatic snapshots built with {@link buildSnapshot}. */
  full: boolean;
  autosave?: boolean;
  label?: string;
}): DatabaseRecord {
  return {
    id: crypto.randomUUID(),
    documentId: input.documentId,
    versionNumber: input.versionNumber,
    data: JSON.stringify(input.data),
    createdAt: new Date().toISOString(),
    createdBy: input.user?.id ?? null,
    autosave: input.autosave ?? false,
    ...(input.full && { snapshotFormat: FULL_SNAPSHOT }),
    ...(input.label !== undefined && { label: input.label })
  };
}

/** A version as restore needs it: the public shape plus whether its data is a full snapshot. */
export interface RestorableVersion {
  version: Version;
  full: boolean;
}

/** Raw (trusted, unfiltered) version read for restore — `getVersion` does not expose the format marker. */
export async function readVersionForRestore(
  ctx: OperationContext,
  collection: CollectionDefinition,
  versionId: string
): Promise<RestorableVersion> {
  const record = await ctx.adapters.database.findById(
    versionsCollectionSlug(collection.slug),
    versionId
  );
  if (!record) throw new NotFoundError(`Version '${versionId}' not found`);
  return { version: toVersion(record), full: record.snapshotFormat === FULL_SNAPSHOT };
}

/**
 * What a restore sets (spec 062 §6). A full snapshot sets every *currently* declared field — a field the
 * snapshot lacks did not exist then, so it becomes `null` (and fails current validation if it is now
 * required). A legacy/manual snapshot may be a patch, so only the declared fields it contains are set.
 * System metadata and undeclared keys are dropped either way.
 */
export function restoreTarget(
  collection: CollectionDefinition,
  restorable: RestorableVersion
): Record<string, unknown> {
  const data = restorable.version.data;
  const target: Record<string, unknown> = {};
  for (const name of Object.keys(collection.fields)) {
    if (name in data) target[name] = data[name];
    else if (restorable.full) target[name] = null;
  }
  if (collection.drafts === true && data._status !== undefined) target._status = data._status;
  for (const key of SYSTEM_KEYS) delete target[key];
  return target;
}

/** Only the target fields whose value differs from the current document. */
export function diffAgainst(
  target: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (!sameValue(value, current[key])) patch[key] = value;
  }
  return patch;
}

function comparable(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, comparable((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/** One duplicated version identity found by {@link findDuplicateVersionIdentities}. */
export interface DuplicateVersionIdentity {
  documentId: string;
  versionNumber: number;
  rows: number;
}

const DUPLICATE_SCAN_PAGE = 500;

/**
 * Scans a version table for `(documentId, versionNumber)` pairs held by more than one row — history the
 * pre-062 read-then-insert race could produce, and which blocks the unique index (spec 062 §8). Reads
 * only; never repairs. Pages through the table in identity order with the ordinary adapter API, so it
 * works on every adapter (an upgrade/diagnostic path, not a hot path).
 */
export async function findDuplicateVersionIdentities(
  database: DatabaseAdapter,
  versionsCollection: string
): Promise<DuplicateVersionIdentity[]> {
  const duplicates: DuplicateVersionIdentity[] = [];
  let previous: { documentId: string; versionNumber: number; rows: number } | undefined;

  for (let offset = 0; ; offset += DUPLICATE_SCAN_PAGE) {
    const page = await database.findMany({
      collection: versionsCollection,
      sort: [
        { field: 'documentId', order: 'asc' },
        { field: 'versionNumber', order: 'asc' },
        { field: 'id', order: 'asc' }
      ],
      limit: DUPLICATE_SCAN_PAGE,
      offset
    });

    for (const row of page) {
      const documentId = String(row.documentId);
      const versionNumber = Number(row.versionNumber);
      if (
        previous &&
        previous.documentId === documentId &&
        previous.versionNumber === versionNumber
      ) {
        previous.rows++;
        if (previous.rows === 2) duplicates.push(previous);
      } else {
        previous = { documentId, versionNumber, rows: 1 };
      }
    }
    if (page.length < DUPLICATE_SCAN_PAGE) return duplicates;
  }
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
