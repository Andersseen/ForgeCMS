import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

/**
 * GET /api/site/posts — public, published-only post list, called through the Local API with
 * `overrideAccess: false, user: null`: the server route states the anonymous identity itself (a
 * `posts` document's `access.read` returns `true` for everyone, but `drafts: true` still hides
 * anything not `_status: 'published'` from an anonymous caller) — no internal HTTP hop, the same
 * pattern `apps/demo-aesthetics`'s `/api/site/*` routes use. The Angular pages read the same data
 * through an anonymous `CmsApiService` instead, because they also render on the server (spec 078).
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
