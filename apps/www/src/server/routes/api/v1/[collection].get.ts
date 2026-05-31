import { defineEventHandler, getRouterParam, getRequestURL, createError } from 'h3';
import { serverRuntimePromise } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await serverRuntimePromise;
  const collection = getRouterParam(event, 'collection');
  if (!collection) {
    throw createError({ statusCode: 400, statusMessage: 'Missing collection parameter' });
  }

  const collectionDef = serverRuntime.getCollection(collection);
  if (!collectionDef) {
    throw createError({ statusCode: 404, statusMessage: `Collection '${collection}' not found` });
  }

  const url = getRequestURL(event);
  const limit = url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
  const offset = url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;

  const records = await serverRuntime.adapters.database.findMany({
    collection,
    ...(limit !== undefined && { limit }),
    ...(offset !== undefined && { offset })
  });

  return {
    data: records,
    meta: { collection, count: records.length, limit, offset }
  };
});
