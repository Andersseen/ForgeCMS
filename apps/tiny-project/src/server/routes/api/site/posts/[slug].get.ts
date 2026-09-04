import { defineEventHandler, getRouterParam, createError } from 'h3';
import { getServerRuntime } from '../../../../api/runtime';

/** GET /api/site/posts/:slug — public, published-only single post, populated author. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? '';
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const doc = await runtime.findOne({
    collection: 'posts',
    where: { slug },
    overrideAccess: false,
    user: null,
    depth: 1
  });

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }

  return { data: doc };
});
