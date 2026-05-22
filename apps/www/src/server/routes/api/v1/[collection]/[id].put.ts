import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { validateCollection } from '@forge-cms/core';
import { serverRuntime } from '../../../../api/runtime';

export default defineEventHandler(async (event) => {
  const collection = getRouterParam(event, 'collection');
  const id = getRouterParam(event, 'id');

  if (!collection || !id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing collection or id parameter' });
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

  // Validate only fields present in the partial update
  const partialData = { ...body, id };
  const validation = validateCollection(collectionDef, partialData);
  if (!validation.valid) {
    const relevantErrors = validation.errors.filter(
      (e) => body[e.field] !== undefined || e.code === 'required'
    );
    if (relevantErrors.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: { errors: relevantErrors }
      });
    }
  }

  const record = await serverRuntime.adapters.database.update(collection, id, body);
  return { data: record };
});
