import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { validateCollection } from '@forge-cms/core';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime();
  const collection = getRouterParam(event, 'collection');
  if (!collection) {
    throw createError({ statusCode: 400, statusMessage: 'Missing collection parameter' });
  }

  const collectionDef = serverRuntime.getCollection(collection);
  if (!collectionDef) {
    throw createError({ statusCode: 404, statusMessage: `Collection '${collection}' not found` });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  const validation = validateCollection(collectionDef, body);
  if (!validation.valid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: { errors: validation.errors }
    });
  }

  const record = await serverRuntime.adapters.database.create(collection, body);
  return { data: record };
});
