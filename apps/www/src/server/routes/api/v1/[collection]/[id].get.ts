import { defineEventHandler, getRouterParam, createError } from 'h3';
import { getServerRuntime } from '../../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime();
  const collection = getRouterParam(event, 'collection');
  const id = getRouterParam(event, 'id');

  if (!collection || !id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing collection or id parameter' });
  }

  const collectionDef = serverRuntime.getCollection(collection);
  if (!collectionDef) {
    throw createError({ statusCode: 404, statusMessage: `Collection '${collection}' not found` });
  }

  const record = await serverRuntime.adapters.database.findById(collection, id);
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: `Record '${id}' not found` });
  }

  return { data: record };
});
