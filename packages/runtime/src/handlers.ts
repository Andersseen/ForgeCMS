import type { ApiContext } from '@forge-cms/api';
import type { ForgeCmsRuntime } from './runtime.js';
import type { DatabaseWhere } from '@forge-cms/db';
import type { CollectionDefinition, DraftStatus } from '@forge-cms/core';
import { getLogger } from '@forge-cms/core';
import type { AuthUser, UserRole } from '@forge-cms/auth';
import { hasAnyRole } from '@forge-cms/auth';
import * as operations from './operations.js';
import type { PaginatedDocs } from './operations.js';
import {
  AccessDeniedError,
  InvalidInputError,
  InvalidQueryError,
  isForgeError,
  toApiErrorBody
} from './errors.js';

const WHERE_OPERATORS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const SYSTEM_SORT_FIELDS = new Set(['id', 'created_at', 'updated_at']);
const RESERVED_QUERY_PARAMS = new Set([
  'limit',
  'offset',
  'sort',
  'order',
  'depth',
  'status',
  'locale'
]);
const WHERE_KEY_PATTERN = /^(.+)\[(\w+)\]$/;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface HandlerOptions<TEnv = unknown> {
  runtime: ForgeCmsRuntime<TEnv>;
  requireAuth?: boolean;
  allowedRoles?: UserRole[];
  upload?: {
    maxFileSize?: number;
    mimeTypes?: string[];
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function errorResponse(code: string, message: string, status: number, details?: unknown): Response {
  return jsonResponse(
    { error: { code, message, ...(details !== undefined && { details }) } },
    status
  );
}

function toErrorResponse(err: unknown, user: AuthUser | null): Response {
  if (err instanceof AccessDeniedError && user === null) {
    return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }
  if (isForgeError(err)) {
    const body = toApiErrorBody(err);
    return jsonResponse(body, err.status);
  }
  getLogger().error('Unexpected error in request handler', err);
  return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}

// --- request parsing -------------------------------------------------------------------------

function coerceScalar(collection: CollectionDefinition, key: string, value: string): unknown {
  const field = collection.fields[key];
  if (!field) return value;

  switch (field.kind) {
    case 'number': {
      const num = Number(value);
      if (Number.isNaN(num)) throw new InvalidInputError(`Invalid filter value for field '${key}'`);
      return num;
    }
    case 'boolean': {
      if (value !== 'true' && value !== 'false') {
        throw new InvalidInputError(`Invalid filter value for field '${key}'`);
      }
      return value === 'true';
    }
    default:
      return value;
  }
}

function assertValidFilterField(collection: CollectionDefinition, key: string): void {
  if (!SYSTEM_SORT_FIELDS.has(key) && !collection.fields[key]) {
    throw new InvalidQueryError(
      `Unknown filter field '${key}' for collection '${collection.slug}'`
    );
  }
}

function parseWhere(collection: CollectionDefinition, url: URL): DatabaseWhere {
  const where: DatabaseWhere = {};

  url.searchParams.forEach((value, rawKey) => {
    if (RESERVED_QUERY_PARAMS.has(rawKey)) return;

    const match = WHERE_KEY_PATTERN.exec(rawKey);
    if (!match) {
      assertValidFilterField(collection, rawKey);
      where[rawKey] = coerceScalar(collection, rawKey, value);
      return;
    }

    const [, key, operator] = match;
    if (!key || !operator || !WHERE_OPERATORS.has(operator)) {
      throw new InvalidQueryError(`Invalid filter operator in '${rawKey}'`);
    }

    assertValidFilterField(collection, key);

    if (operator === 'in') {
      where[key] = {
        ...(isOperatorObject(where[key]) && where[key]),
        in: value.split(',').map((v) => coerceScalar(collection, key, v))
      };
    } else if (operator === 'eq') {
      where[key] = coerceScalar(collection, key, value);
    } else {
      where[key] = {
        ...(isOperatorObject(where[key]) && where[key]),
        [operator]: coerceScalar(collection, key, value)
      };
    }
  });

  return where;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSort(
  collection: CollectionDefinition,
  url: URL
): { sort?: string; order?: 'asc' | 'desc' } {
  const sortParam = url.searchParams.get('sort');
  if (!sortParam) return {};

  if (!SYSTEM_SORT_FIELDS.has(sortParam) && !collection.fields[sortParam]) {
    throw new InvalidQueryError(
      `Unknown sort field '${sortParam}' for collection '${collection.slug}'`
    );
  }

  const orderParam = url.searchParams.get('order');
  if (orderParam === null) return { sort: sortParam };
  if (orderParam !== 'asc' && orderParam !== 'desc') {
    throw new InvalidQueryError(`Invalid sort order '${orderParam}', expected 'asc' or 'desc'`);
  }

  return { sort: sortParam, order: orderParam };
}

function parseDepth(url: URL): 0 | 1 {
  const raw = url.searchParams.get('depth');
  if (raw === null || raw === '0') return 0;
  if (raw === '1') return 1;
  throw new InvalidQueryError(`Invalid depth '${raw}', expected '0' or '1'`);
}

function parseStatus(url: URL): DraftStatus | 'all' | undefined {
  const raw = url.searchParams.get('status');
  if (raw === null) return undefined;
  if (raw === 'draft' || raw === 'published' || raw === 'all') return raw;
  throw new InvalidQueryError(`Invalid status '${raw}', expected 'draft', 'published', or 'all'`);
}

function parseLocale(url: URL): string | undefined {
  const raw = url.searchParams.get('locale');
  return raw ?? undefined;
}

function parseStrictInt(
  url: URL,
  name: string,
  opts: { min: number; max?: number }
): number | undefined {
  if (!url.searchParams.has(name)) return undefined;
  const raw = url.searchParams.get(name)!;

  if (!/^-?\d+$/.test(raw)) {
    throw new InvalidQueryError(`Invalid ${name} value '${raw}', expected an integer`);
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new InvalidQueryError(`Invalid ${name} value '${raw}'`);
  }
  if (parsed < opts.min) {
    throw new InvalidQueryError(`${name} must be >= ${opts.min}, got ${parsed}`);
  }
  if (opts.max !== undefined && parsed > opts.max) {
    throw new InvalidQueryError(`${name} must be <= ${opts.max}, got ${parsed}`);
  }
  return parsed;
}

function parseLimit(url: URL): number | undefined {
  return parseStrictInt(url, 'limit', { min: 0, max: MAX_LIMIT });
}

function parseOffset(url: URL): number | undefined {
  return parseStrictInt(url, 'offset', { min: 0 });
}

// --- auth ------------------------------------------------------------------------------------

type AuthorizationResult =
  | { success: true; user: AuthUser }
  | { success: false; response: Response };

async function authorize<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>,
  allowedRoles?: UserRole[]
): Promise<AuthorizationResult> {
  let user: AuthUser;
  try {
    user = await runtime.adapters.auth.requireAuth(context.request);
  } catch {
    return { success: false, response: errorResponse('UNAUTHORIZED', 'Unauthorized', 401) };
  }

  if (allowedRoles !== undefined && !hasAnyRole(user, allowedRoles)) {
    return { success: false, response: errorResponse('FORBIDDEN', 'Forbidden', 403) };
  }

  return { success: true, user };
}

async function resolveOptionalUser<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<AuthUser | null> {
  try {
    return await runtime.adapters.auth.requireAuth(context.request);
  } catch {
    return null;
  }
}

interface ResolvedRequest {
  collection: CollectionDefinition;
  collectionSlug: string;
  user: AuthUser | null;
}

async function resolveRequest<TEnv>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>,
  operation: 'read' | 'create' | 'update' | 'delete',
  needsId: boolean
): Promise<ResolvedRequest | Response> {
  const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

  const collectionSlug = context.params?.['collection'];
  if (!collectionSlug) return errorResponse('INVALID_INPUT', 'Missing collection parameter', 400);
  if (needsId && !context.params?.['id']) {
    return errorResponse('INVALID_INPUT', 'Missing collection or id parameter', 400);
  }

  const collection = runtime.getCollection(collectionSlug);
  if (!collection)
    return errorResponse('NOT_FOUND', `Collection '${collectionSlug}' not found`, 404);

  const routeRoles = collection.access?.[operation] === undefined ? allowedRoles : undefined;
  const mustAuth = requireAuthFlag === true || routeRoles !== undefined;

  let user: AuthUser | null = null;
  if (mustAuth) {
    const result = await authorize(context, runtime, routeRoles);
    if (!result.success) return result.response;
    user = result.user;
  } else {
    user = await resolveOptionalUser(context, runtime);
  }

  return { collection, collectionSlug, user };
}

// --- handlers --------------------------------------------------------------------------------

export async function handleList<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'read', false);
  if (resolved instanceof Response) return resolved;
  const { collection, collectionSlug, user } = resolved;

  try {
    const url = new URL(context.request.url);
    const where = parseWhere(collection, url);
    const { sort, order } = parseSort(collection, url);
    const limit = parseLimit(url);
    const offset = parseOffset(url);

    const locale = parseLocale(url);
    const result: PaginatedDocs = await options.runtime.find({
      collection: collectionSlug,
      user,
      overrideAccess: false,
      depth: parseDepth(url),
      ...(Object.keys(where).length > 0 && { where }),
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
      ...(sort !== undefined && { sort }),
      ...(order !== undefined && { order }),
      ...(parseStatus(url) !== undefined && { status: parseStatus(url)! }),
      ...(locale !== undefined && { locale })
    });

    return jsonResponse({
      data: result.docs,
      meta: {
        collection: collectionSlug,
        count: result.docs.length,
        limit: result.limit,
        offset: result.offset,
        totalDocs: result.totalDocs,
        page: result.page,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage
      }
    });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleRead<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'read', true);
  if (resolved instanceof Response) return resolved;
  const { collectionSlug, user } = resolved;

  try {
    const url = new URL(context.request.url);
    const status = parseStatus(url);
    const locale = parseLocale(url);

    const doc = await options.runtime.findByID({
      collection: collectionSlug,
      id: context.params!['id']!,
      user,
      overrideAccess: false,
      depth: parseDepth(url),
      ...(status !== undefined && { status }),
      ...(locale !== undefined && { locale })
    });

    return jsonResponse({ data: doc });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

async function buildMultipartBody<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>,
  collection: CollectionDefinition,
  uploadConfig?: { maxFileSize?: number; mimeTypes?: string[] }
): Promise<{ data: Record<string, unknown>; storageKey: string }> {
  const formData = await context.request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new InvalidInputError('Missing or invalid "file" part in multipart body');
  }

  if (uploadConfig?.maxFileSize !== undefined && file.size > uploadConfig.maxFileSize) {
    throw new InvalidInputError(
      `File size ${file.size} exceeds maximum allowed size of ${uploadConfig.maxFileSize} bytes`
    );
  }

  if (uploadConfig?.mimeTypes !== undefined && uploadConfig.mimeTypes.length > 0) {
    if (!uploadConfig.mimeTypes.includes(file.type)) {
      throw new InvalidInputError(
        `File type '${file.type}' is not allowed. Allowed types: ${uploadConfig.mimeTypes.join(', ')}`
      );
    }
  }

  const key = `${collection.slug}/${crypto.randomUUID()}-${file.name}`;

  await runtime.adapters.storage.put({ key, body: file, contentType: file.type });

  const url = await runtime.adapters.storage.getPublicUrl(key);

  const data: Record<string, unknown> = { _storageKey: key };
  const derived: Record<string, unknown> = {
    filename: file.name,
    url,
    contentType: file.type,
    filesize: file.size
  };
  for (const [name, value] of Object.entries(derived)) {
    if (collection.fields[name]) data[name] = value;
  }

  formData.forEach((value, name) => {
    if (name !== 'file' && typeof value === 'string' && collection.fields[name]) {
      data[name] = value;
    }
  });

  return { data, storageKey: key };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new InvalidInputError('Invalid JSON body');
  }
}

export async function handleCreate<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'create', false);
  if (resolved instanceof Response) return resolved;
  const { collection, collectionSlug, user } = resolved;

  try {
    const contentType = context.request.headers.get('content-type') ?? '';
    let data: Record<string, unknown>;
    let storageKey: string | undefined;

    if (collection.upload === true && contentType.includes('multipart/form-data')) {
      const result = await buildMultipartBody(context, options.runtime, collection, options.upload);
      data = result.data;
      storageKey = result.storageKey;
    } else {
      data = await readJsonBody(context.request);
    }

    try {
      const locale = parseLocale(new URL(context.request.url));
      const doc = await options.runtime.create({
        collection: collectionSlug,
        data,
        user,
        overrideAccess: false,
        ...(locale !== undefined && { locale })
      });

      return jsonResponse({ data: doc }, 201);
    } catch (createErr) {
      if (storageKey) {
        try {
          await options.runtime.adapters.storage.delete(storageKey);
        } catch (cleanupErr) {
          getLogger().error(
            `Failed to clean up storage object '${storageKey}' after document creation failure`,
            cleanupErr
          );
        }
      }
      throw createErr;
    }
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleUpdate<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'update', true);
  if (resolved instanceof Response) return resolved;
  const { collectionSlug, user } = resolved;

  try {
    const locale = parseLocale(new URL(context.request.url));
    const doc = await options.runtime.update({
      collection: collectionSlug,
      id: context.params!['id']!,
      data: await readJsonBody(context.request),
      user,
      overrideAccess: false,
      ...(locale !== undefined && { locale })
    });

    return jsonResponse({ data: doc });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleDelete<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'delete', true);
  if (resolved instanceof Response) return resolved;
  const { collection, collectionSlug, user } = resolved;

  try {
    const existing =
      collection.upload === true
        ? await options.runtime.adapters.database.findById(collectionSlug, context.params!['id']!)
        : null;

    await options.runtime.delete({
      collection: collectionSlug,
      id: context.params!['id']!,
      user,
      overrideAccess: false
    });

    if (existing && typeof existing.url === 'string') {
      const storageKey =
        (existing._storageKey as string) ??
        extractKeyFromUrl(existing.url as string, collectionSlug);
      if (storageKey) {
        try {
          await options.runtime.adapters.storage.delete(storageKey);
        } catch (cleanupErr) {
          getLogger().error(
            `Failed to clean up storage object '${storageKey}' after document deletion`,
            cleanupErr
          );
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

function extractKeyFromUrl(url: string, collectionSlug: string): string | null {
  const prefix = `/api/media/${collectionSlug}/`;
  const idx = url.indexOf(prefix);
  if (idx === -1) return null;
  return url.slice(idx + '/api/media/'.length);
}

// --- globals --------------------------------------------------------------------------------

interface ResolvedGlobalRequest {
  globalSlug: string;
  user: AuthUser | null;
}

async function resolveGlobalRequest<TEnv>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>,
  operation: 'read' | 'update'
): Promise<ResolvedGlobalRequest | Response> {
  const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

  const globalSlug = context.params?.['global'];
  if (!globalSlug) return errorResponse('INVALID_INPUT', 'Missing global parameter', 400);

  const global = runtime.getGlobal(globalSlug);
  if (!global) return errorResponse('NOT_FOUND', `Global '${globalSlug}' not found`, 404);

  const routeRoles = global.access?.[operation] === undefined ? allowedRoles : undefined;
  const mustAuth = requireAuthFlag === true || routeRoles !== undefined;

  let user: AuthUser | null = null;
  if (mustAuth) {
    const result = await authorize(context, runtime, routeRoles);
    if (!result.success) return result.response;
    user = result.user;
  } else {
    user = await resolveOptionalUser(context, runtime);
  }

  return { globalSlug, user };
}

export async function handleGlobalRead<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveGlobalRequest(context, options, 'read');
  if (resolved instanceof Response) return resolved;
  const { globalSlug, user } = resolved;

  try {
    const doc = await options.runtime.getGlobalDocument({
      global: globalSlug,
      user,
      overrideAccess: false
    });

    if (!doc) {
      return errorResponse('NOT_FOUND', `Global '${globalSlug}' has not been configured yet`, 404);
    }

    return jsonResponse({ data: doc });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleGlobalUpdate<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveGlobalRequest(context, options, 'update');
  if (resolved instanceof Response) return resolved;
  const { globalSlug, user } = resolved;

  try {
    const doc = await options.runtime.updateGlobalDocument({
      global: globalSlug,
      data: await readJsonBody(context.request),
      user,
      overrideAccess: false
    });

    return jsonResponse({ data: doc });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

// --- versions -------------------------------------------------------------------------------

export async function handleListVersions<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'read', true);
  if (resolved instanceof Response) return resolved;
  const { collectionSlug, user } = resolved;

  try {
    const url = new URL(context.request.url);
    const limit = parseLimit(url);
    const offset = parseOffset(url);

    const versions = await options.runtime.listVersions({
      collection: collectionSlug,
      documentId: context.params!['id']!,
      user,
      overrideAccess: false,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset })
    });

    return jsonResponse({ data: versions });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleGetVersion<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'read', false);
  if (resolved instanceof Response) return resolved;
  const { collectionSlug, user } = resolved;

  try {
    const versionId = context.params?.['versionId'];
    if (!versionId) {
      return errorResponse('INVALID_INPUT', 'Missing versionId parameter', 400);
    }

    const version = await options.runtime.getVersion({
      collection: collectionSlug,
      versionId,
      user,
      overrideAccess: false
    });

    return jsonResponse({ data: version });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export async function handleRestoreVersion<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  const resolved = await resolveRequest(context, options, 'update', false);
  if (resolved instanceof Response) return resolved;
  const { collectionSlug, user } = resolved;

  try {
    const versionId = context.params?.['versionId'];
    if (!versionId) {
      return errorResponse('INVALID_INPUT', 'Missing versionId parameter', 400);
    }

    const record = await options.runtime.restoreVersion({
      collection: collectionSlug,
      versionId,
      user,
      overrideAccess: false
    });

    return jsonResponse({ data: record });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

// --- preview --------------------------------------------------------------------------------

export interface PreviewOptions {
  /** Allow previewing drafts without authentication (for preview tokens). */
  allowDraftPreview?: boolean;
}

/**
 * Generates a preview of a document by merging stored data with unsaved changes.
 * Useful for live preview in the admin UI before saving.
 */
export async function handlePreview<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv> & PreviewOptions
): Promise<Response> {
  const collectionSlug = context.params?.['collection'];
  if (!collectionSlug) {
    return errorResponse('INVALID_INPUT', 'Missing collection parameter', 400);
  }

  const collection = options.runtime.getCollection(collectionSlug);
  if (!collection) {
    return errorResponse('NOT_FOUND', `Collection '${collectionSlug}' not found`, 404);
  }

  let user: AuthUser | null = null;
  try {
    user = await options.runtime.adapters.auth.requireAuth(context.request);
  } catch {
    // Preview might be allowed without auth for draft preview
    if (!options.allowDraftPreview) {
      return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
    }
  }

  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const documentId = context.params?.['id'];
    const depth = parseDepth(new URL(context.request.url));

    let previewData: Record<string, unknown>;
    let existing: Record<string, unknown> | null = null;

    if (documentId) {
      // Preview existing document with changes
      existing = await options.runtime.adapters.database.findById(collectionSlug, documentId);
      if (!existing) {
        return errorResponse('NOT_FOUND', `Document '${documentId}' not found`, 404);
      }
      previewData = { ...existing, ...body };
    } else {
      // Preview new document
      previewData = body;
    }

    // Apply field defaults and auto-slugs
    const { applyFieldDefaults, applyAutoSlugs } = await import('./defaults.js');
    previewData = applyAutoSlugs(
      collection,
      applyFieldDefaults(collection, previewData),
      existing ?? undefined
    );

    // Populate relations if depth > 0
    if (depth > 0) {
      const { populateRecord } = await import('./populate.js');
      previewData = await populateRecord(previewData, collection, options.runtime);
    }

    return jsonResponse({ data: previewData });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export { operations };
export { DEFAULT_LIMIT, MAX_LIMIT };
