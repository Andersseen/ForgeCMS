import { defineEventHandler, getRouterParam, createError } from 'h3';
import { serverRuntimePromise } from '../../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await serverRuntimePromise;
  const collection = getRouterParam(event, 'collection');
  const id = getRouterParam(event, 'id');

  if (!collection || !id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing collection or id parameter' });
  }

  const collectionDef = serverRuntime.getCollection(collection);
  if (!collectionDef) {
    throw createError({ statusCode: 404, statusMessage: `Collection '${collection}' not found` });
  }

  await serverRuntime.adapters.database.delete(collection, id);
  return new Response(null, { status: 204 });
});
