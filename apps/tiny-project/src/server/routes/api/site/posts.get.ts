import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/site/posts — public, published-only post list, called through the Local API with
 * `overrideAccess: false, user: null` so the page runs under the real anonymous access rule (a
 * `posts` document's `access.read` returns `true` for everyone, but `drafts: true` still hides
 * anything not `_status: 'published'` from an anonymous caller) instead of the generic authenticated
 * `/api/v1/posts` route — the same pattern `apps/demo-aesthetics`'s `/api/site/*` routes use.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const result = await runtime.find({
    collection: 'posts',
    overrideAccess: false,
    user: null,
    depth: 1,
    sort: 'title'
  });
  return { data: result.docs, meta: { totalDocs: result.totalDocs } };
});
