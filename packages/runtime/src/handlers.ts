import { validateCollection } from '@forge-cms/core';
import type { ApiContext } from '@forge-cms/api';
import type { ForgeCmsRuntime } from './runtime.js';
import type { DatabaseRecord, DatabaseWhere } from '@forge-cms/db';
import type { CollectionDefinition } from '@forge-cms/core';
import type { AuthUser, UserRole } from '@forge-cms/auth';
import { hasAnyRole } from '@forge-cms/auth';

const WHERE_OPERATORS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const SYSTEM_SORT_FIELDS = new Set(['id', 'created_at', 'updated_at']);
const RESERVED_QUERY_PARAMS = new Set(['limit', 'offset', 'sort', 'order']);
const WHERE_KEY_PATTERN = /^(.+)\[(\w+)\]$/;

class FilterCoercionError extends Error {
  constructor(readonly field: string) {
    super(`Invalid filter value for field '${field}'`);
  }
}

class SortFieldError extends Error {
  constructor(readonly field: string) {
    super(`Invalid sort field '${field}'`);
  }
}

class SortOrderError extends Error {
  constructor(readonly order: string) {
    super(`Invalid sort order '${order}', expected 'asc' or 'desc'`);
  }
}

/** Coerce a raw query-param string to the value type declared by the field (bare `eq` semantics). */
function coerceScalar(collection: CollectionDefinition, key: string, value: string): unknown {
  const field = collection.fields[key];
  if (!field) return value;

  switch (field.kind) {
    case 'number': {
      const num = Number(value);
      if (Number.isNaN(num)) throw new FilterCoercionError(key);
      return num;
    }
    case 'boolean': {
      if (value !== 'true' && value !== 'false') throw new FilterCoercionError(key);
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
function coerceWhere(collection: CollectionDefinition, raw: Record<string, string>): DatabaseWhere {
  const where: DatabaseWhere = {};

  for (const [rawKey, value] of Object.entries(raw)) {
    const match = WHERE_KEY_PATTERN.exec(rawKey);
    if (!match) {
      where[rawKey] = coerceScalar(collection, rawKey, value);
      continue;
    }

    const [, key, operator] = match;
    if (!key || !operator || !WHERE_OPERATORS.has(operator)) {
      throw new FilterCoercionError(rawKey);
    }

    if (operator === 'in') {
      where[key] = { in: value.split(',').map((v) => coerceScalar(collection, key, v)) };
    } else if (operator === 'eq') {
      where[key] = coerceScalar(collection, key, value);
    } else {
      where[key] = { [operator]: coerceScalar(collection, key, value) };
    }
  }

  return where;
}

/** Parse and validate `sort`/`order` query params against the collection's known fields. */
function parseSort(
  collection: CollectionDefinition,
  url: URL
): { sort?: string; order?: 'asc' | 'desc' } {
  const sortParam = url.searchParams.get('sort');
  if (!sortParam) return {};

  if (!SYSTEM_SORT_FIELDS.has(sortParam) && !collection.fields[sortParam]) {
    throw new SortFieldError(sortParam);
  }

  const orderParam = url.searchParams.get('order');
  if (orderParam === null) return { sort: sortParam };
  if (orderParam !== 'asc' && orderParam !== 'desc') {
    throw new SortOrderError(orderParam);
  }

  return { sort: sortParam, order: orderParam };
}

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

type AuthorizationResult<T> = { success: true; user: T } | { success: false; response: Response };

async function authorize<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>,
  allowedRoles?: UserRole[]
): Promise<AuthorizationResult<AuthUser>> {
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

export async function handleList<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

    if (requireAuthFlag || allowedRoles !== undefined) {
      const result = await authorize(context, runtime, allowedRoles);
      if (!result.success) return result.response;
    }

    const collectionSlug = context.params?.['collection'];
    if (!collectionSlug) return errorResponse('Missing collection parameter', 400);

    const collection = runtime.getCollection(collectionSlug);
    if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

    const url = new URL(context.request.url);
    const limit = url.searchParams.has('limit')
      ? parseInt(url.searchParams.get('limit')!, 10)
      : undefined;
    const offset = url.searchParams.has('offset')
      ? parseInt(url.searchParams.get('offset')!, 10)
      : undefined;

    const rawWhere: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (!RESERVED_QUERY_PARAMS.has(key)) {
        rawWhere[key] = value;
      }
    });

    let where: DatabaseWhere;
    let sort: { sort?: string; order?: 'asc' | 'desc' };
    try {
      where = coerceWhere(collection, rawWhere);
      sort = parseSort(collection, url);
    } catch (err) {
      if (err instanceof FilterCoercionError || err instanceof SortOrderError) {
        return errorResponse(err.message, 400);
      }
      if (err instanceof SortFieldError) return errorResponse(err.message, 400);
      throw err;
    }

    const records = await runtime.adapters.database.findMany({
      collection: collectionSlug,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
      ...(Object.keys(where).length > 0 && { where }),
      ...(sort.sort !== undefined && { sort: sort.sort }),
      ...(sort.order !== undefined && { order: sort.order })
    });

    return jsonResponse({
      data: records,
      meta: { collection: collectionSlug, count: records.length, limit, offset }
    });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export async function handleRead<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

    if (requireAuthFlag || allowedRoles !== undefined) {
      const result = await authorize(context, runtime, allowedRoles);
      if (!result.success) return result.response;
    }

    const collectionSlug = context.params?.['collection'];
    const id = context.params?.['id'];
    if (!collectionSlug || !id) return errorResponse('Missing collection or id parameter', 400);

    const collection = runtime.getCollection(collectionSlug);
    if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

    const record = await runtime.adapters.database.findById(collectionSlug, id);
    if (!record) return errorResponse(`Record '${id}' not found in '${collectionSlug}'`, 404);

    return jsonResponse({ data: record });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export async function handleCreate<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

    if (requireAuthFlag || allowedRoles !== undefined) {
      const result = await authorize(context, runtime, allowedRoles);
      if (!result.success) return result.response;
    }

    const collectionSlug = context.params?.['collection'];
    if (!collectionSlug) return errorResponse('Missing collection parameter', 400);

    const collection = runtime.getCollection(collectionSlug);
    if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

    let body: DatabaseRecord;
    try {
      body = (await context.request.json()) as DatabaseRecord;
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const validation = validateCollection(collection, body);
    if (!validation.valid) {
      return jsonResponse({ error: 'Validation failed', details: validation.errors }, 400);
    }

    const record = await runtime.adapters.database.create(collectionSlug, body);
    return jsonResponse({ data: record }, 201);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export async function handleUpdate<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

    if (requireAuthFlag || allowedRoles !== undefined) {
      const result = await authorize(context, runtime, allowedRoles);
      if (!result.success) return result.response;
    }

    const collectionSlug = context.params?.['collection'];
    const id = context.params?.['id'];
    if (!collectionSlug || !id) return errorResponse('Missing collection or id parameter', 400);

    const collection = runtime.getCollection(collectionSlug);
    if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

    let body: DatabaseRecord;
    try {
      body = (await context.request.json()) as DatabaseRecord;
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const existing = await runtime.adapters.database.findById(collectionSlug, id);
    if (!existing) return errorResponse(`Record '${id}' not found in '${collectionSlug}'`, 404);

    // Merge existing record with the partial body so required fields already present
    // on the stored document do not fail validation. Report only errors for fields the
    // caller is touching (present in body) or for fields that do not exist yet.
    const merged = { ...existing, ...body };
    const validation = validateCollection(collection, merged);
    if (!validation.valid) {
      const relevantErrors = validation.errors.filter(
        (e) => body[e.field] !== undefined || existing[e.field] === undefined
      );
      if (relevantErrors.length > 0) {
        return jsonResponse({ error: 'Validation failed', details: relevantErrors }, 400);
      }
    }

    const record = await runtime.adapters.database.update(collectionSlug, id, body);
    return jsonResponse({ data: record });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export async function handleDelete<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag, allowedRoles } = options;

    if (requireAuthFlag || allowedRoles !== undefined) {
      const result = await authorize(context, runtime, allowedRoles);
      if (!result.success) return result.response;
    }

    const collectionSlug = context.params?.['collection'];
    const id = context.params?.['id'];
    if (!collectionSlug || !id) return errorResponse('Missing collection or id parameter', 400);

    const collection = runtime.getCollection(collectionSlug);
    if (!collection) return errorResponse(`Collection '${collectionSlug}' not found`, 404);

    await runtime.adapters.database.delete(collectionSlug, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
