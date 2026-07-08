import { validateCollection } from '@forge-cms/core';
import type { ApiContext } from '@forge-cms/api';
import type { ForgeCmsRuntime } from './runtime.js';
import type { DatabaseRecord } from '@forge-cms/db';
import type { CollectionDefinition } from '@forge-cms/core';

class FilterCoercionError extends Error {
  constructor(readonly field: string) {
    super(`Invalid filter value for field '${field}'`);
  }
}

/** Coerce raw query-param strings to the value types declared by the collection's fields. */
function coerceWhere(
  collection: CollectionDefinition,
  raw: Record<string, string>
): DatabaseRecord {
  const where: DatabaseRecord = {};

  for (const [key, value] of Object.entries(raw)) {
    const field = collection.fields[key];
    if (!field) {
      where[key] = value;
      continue;
    }

    switch (field.kind) {
      case 'number': {
        const num = Number(value);
        if (Number.isNaN(num)) throw new FilterCoercionError(key);
        where[key] = num;
        break;
      }
      case 'boolean': {
        if (value !== 'true' && value !== 'false') throw new FilterCoercionError(key);
        where[key] = value === 'true';
        break;
      }
      default:
        where[key] = value;
    }
  }

  return where;
}

export interface HandlerOptions<TEnv = unknown> {
  runtime: ForgeCmsRuntime<TEnv>;
  requireAuth?: boolean;
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

async function requireAuth<TEnv>(
  context: ApiContext<TEnv>,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<unknown | null> {
  try {
    return await runtime.adapters.auth.requireAuth(context.request);
  } catch {
    return null;
  }
}

export async function handleList<TEnv = unknown>(
  context: ApiContext<TEnv>,
  options: HandlerOptions<TEnv>
): Promise<Response> {
  try {
    const { runtime, requireAuth: requireAuthFlag } = options;

    if (requireAuthFlag) {
      const user = await requireAuth(context, runtime);
      if (!user) return errorResponse('Unauthorized', 401);
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
      if (key !== 'limit' && key !== 'offset') {
        rawWhere[key] = value;
      }
    });

    let where: DatabaseRecord;
    try {
      where = coerceWhere(collection, rawWhere);
    } catch (err) {
      if (err instanceof FilterCoercionError) return errorResponse(err.message, 400);
      throw err;
    }

    const records = await runtime.adapters.database.findMany({
      collection: collectionSlug,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
      ...(Object.keys(where).length > 0 && { where })
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
    const { runtime, requireAuth: requireAuthFlag } = options;

    if (requireAuthFlag) {
      const user = await requireAuth(context, runtime);
      if (!user) return errorResponse('Unauthorized', 401);
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
    const { runtime, requireAuth: requireAuthFlag } = options;

    if (requireAuthFlag) {
      const user = await requireAuth(context, runtime);
      if (!user) return errorResponse('Unauthorized', 401);
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
    const { runtime, requireAuth: requireAuthFlag } = options;

    if (requireAuthFlag) {
      const user = await requireAuth(context, runtime);
      if (!user) return errorResponse('Unauthorized', 401);
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

    // For partial updates, we validate only the fields present in the body
    const partialValidation = validateCollection(collection, { ...body, id });
    if (!partialValidation.valid) {
      // Filter to only errors for fields that were actually sent
      const relevantErrors = partialValidation.errors.filter(
        (e) => body[e.field] !== undefined || e.code === 'required'
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
    const { runtime, requireAuth: requireAuthFlag } = options;

    if (requireAuthFlag) {
      const user = await requireAuth(context, runtime);
      if (!user) return errorResponse('Unauthorized', 401);
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
