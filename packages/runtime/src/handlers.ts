import type { ApiContext } from '@forge-cms/api';
import type { ForgeCmsRuntime } from './runtime.js';
import type { DatabaseWhere } from '@forge-cms/db';
import type { CollectionDefinition, DraftStatus } from '@forge-cms/core';
import type { AuthUser, UserRole } from '@forge-cms/auth';
import { hasAnyRole } from '@forge-cms/auth';
import * as operations from './operations.js';
import type { PaginatedDocs } from './operations.js';
import {
  AccessDeniedError,
  InvalidInputError,
  ValidationFailedError,
  isForgeError
} from './errors.js';

const WHERE_OPERATORS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const SYSTEM_SORT_FIELDS = new Set(['id', 'created_at', 'updated_at']);
const RESERVED_QUERY_PARAMS = new Set(['limit', 'offset', 'sort', 'order', 'depth', 'status']);
const WHERE_KEY_PATTERN = /^(.+)\[(\w+)\]$/;

export interface HandlerOptions<TEnv = unknown> {
  runtime: ForgeCmsRuntime<TEnv>;
  requireAuth?: boolean;
  allowedRoles?: UserRole[];
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Maps a Local API error to the HTTP envelope. An access denial with no authenticated user is
 * reported as 401 rather than 403 — the caller has not failed a permission check so much as not
 * presented credentials at all.
 */
function toErrorResponse(err: unknown, user: AuthUser | null): Response {
  if (err instanceof ValidationFailedError) {
    return jsonResponse({ error: err.message, details: err.details }, err.status);
  }
  if (err instanceof AccessDeniedError && user === null) {
    return errorResponse('Unauthorized', 401);
  }
  if (isForgeError(err)) {
    return errorResponse(err.message, err.status);
  }
  return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
}

// --- request parsing -------------------------------------------------------------------------

/** Coerce a raw query-param string to the value type declared by the field (bare `eq` semantics). */
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

/**
 * Coerce raw query-param strings to a DatabaseWhere. Supports bare equality (`field=value`) and
 * bracket operator syntax (`field[gt]=value`, `field[in]=a,b,c`, ...).
 */
function parseWhere(collection: CollectionDefinition, url: URL): DatabaseWhere {
  const where: DatabaseWhere = {};

  url.searchParams.forEach((value, rawKey) => {
    if (RESERVED_QUERY_PARAMS.has(rawKey)) return;

    const match = WHERE_KEY_PATTERN.exec(rawKey);
    if (!match) {
      where[rawKey] = coerceScalar(collection, rawKey, value);
      return;
    }

    const [, key, operator] = match;
    if (!key || !operator || !WHERE_OPERATORS.has(operator)) {
      throw new InvalidInputError(`Invalid filter value for field '${rawKey}'`);
    }

    if (operator === 'in') {
      where[key] = { in: value.split(',').map((v) => coerceScalar(collection, key, v)) };
    } else if (operator === 'eq') {
      where[key] = coerceScalar(collection, key, value);
    } else {
      where[key] = { [operator]: coerceScalar(collection, key, value) };
    }
  });

  return where;
}

function parseSort(
  collection: CollectionDefinition,
  url: URL
): { sort?: string; order?: 'asc' | 'desc' } {
  const sortParam = url.searchParams.get('sort');
  if (!sortParam) return {};

  if (!SYSTEM_SORT_FIELDS.has(sortParam) && !collection.fields[sortParam]) {
    throw new InvalidInputError(`Invalid sort field '${sortParam}'`);
  }

  const orderParam = url.searchParams.get('order');
  if (orderParam === null) return { sort: sortParam };
  if (orderParam !== 'asc' && orderParam !== 'desc') {
    throw new InvalidInputError(`Invalid sort order '${orderParam}', expected 'asc' or 'desc'`);
  }

  return { sort: sortParam, order: orderParam };
}

/** Only `0` (default) and `1` are supported. */
function parseDepth(url: URL): 0 | 1 {
  const raw = url.searchParams.get('depth');
  if (raw === null || raw === '0') return 0;
  if (raw === '1') return 1;
  throw new InvalidInputError(`Invalid depth '${raw}', expected '0' or '1'`);
}

function parseStatus(url: URL): DraftStatus | 'all' | undefined {
  const raw = url.searchParams.get('status');
  if (raw === null) return undefined;
  if (raw === 'draft' || raw === 'published' || raw === 'all') return raw;
  throw new InvalidInputError(`Invalid status '${raw}', expected 'draft', 'published', or 'all'`);
}

function parseIntParam(url: URL, name: string): number | undefined {
  if (!url.searchParams.has(name)) return undefined;
  const parsed = parseInt(url.searchParams.get(name)!, 10);
  if (Number.isNaN(parsed)) throw new InvalidInputError(`Invalid ${name} value`);
  return parsed;
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
    return { success: false, response: errorResponse('Unauthorized', 401) };
  }

  if (allowedRoles !== undefined && !hasAnyRole(user, allowedRoles)) {
    return { success: false, response: errorResponse('Forbidden', 403) };
  }

  return { success: true, user };
}

/** Best-effort auth so field-level read access and draft visibility still apply on public routes. */
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

/**
 * Resolves the collection and the acting user, applying the route's static `allowedRoles` gate.
 *
 * A collection that declares its own `access.<operation>` rule takes over from the route gate
 * (spec 013 semantics, preserved): the Local API evaluates that rule instead, which is what allows a
 * rule to be a function returning a row-level constraint.
 */
async function resolveRequest<TEnv>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>,
  operation: 'read' | 'create' | 'update' | 'delete',
  needsId: boolean
): Promise<ResolvedRequest | Response> {
  const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

  const collectionSlug = context.params?.['collection'];
  if (!collectionSlug) return errorResponse('Missing collection parameter', 400);
  if (needsId && !context.params?.['id']) {
    return errorResponse('Missing collection or id parameter', 400);
  }

  const collection = runtime.getCollection(collectionSlug);
  if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

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
    const limit = parseIntParam(url, 'limit');
    const offset = parseIntParam(url, 'offset');

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
      ...(parseStatus(url) !== undefined && { status: parseStatus(url)! })
    });

    return jsonResponse({
      data: result.docs,
      meta: {
        collection: collectionSlug,
        // `count` is the length of this page and predates pagination metadata; it is kept so
        // existing clients do not break. `totalDocs` is the number a paginator needs.
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

    const doc = await options.runtime.findByID({
      collection: collectionSlug,
      id: context.params!['id']!,
      user,
      overrideAccess: false,
      depth: parseDepth(url),
      ...(status !== undefined && { status })
    });

    return jsonResponse({ data: doc });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

/**
 * Reads a `multipart/form-data` create body: stores the `file` part through the storage adapter,
 * then keeps whichever of filename/url/contentType/filesize (plus any other form field) the
 * collection actually declares. Unknown keys are dropped rather than risking an insert against a
 * column the table does not have.
 */
async function buildMultipartBody<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>,
  collection: CollectionDefinition
): Promise<Record<string, unknown>> {
  const formData = await context.request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new InvalidInputError('Missing or invalid "file" part in multipart body');
  }

  const key = `${collection.slug}/${crypto.randomUUID()}-${file.name}`;
  await runtime.adapters.storage.put({ key, body: file, contentType: file.type });
  const url = await runtime.adapters.storage.getPublicUrl(key);

  const data: Record<string, unknown> = {};
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

  return data;
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
    const data =
      collection.upload === true && contentType.includes('multipart/form-data')
        ? await buildMultipartBody(context, options.runtime, collection)
        : await readJsonBody(context.request);

    const doc = await options.runtime.create({
      collection: collectionSlug,
      data,
      user,
      overrideAccess: false
    });

    return jsonResponse({ data: doc }, 201);
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
    const doc = await options.runtime.update({
      collection: collectionSlug,
      id: context.params!['id']!,
      data: await readJsonBody(context.request),
      user,
      overrideAccess: false
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
  const { collectionSlug, user } = resolved;

  try {
    await options.runtime.delete({
      collection: collectionSlug,
      id: context.params!['id']!,
      user,
      overrideAccess: false
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err, user);
  }
}

export { operations };
