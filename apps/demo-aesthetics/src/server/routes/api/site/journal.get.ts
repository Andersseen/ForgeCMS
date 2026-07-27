import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';
import { toPostSummary } from '../../../api/mappers';
import type { PostSummary } from '../../../../shared/site-content';

/** The journal index — published posts, newest first. */
export default defineEventHandler(async (event): Promise<{ data: PostSummary[] }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  const posts = await runtime.find({
    collection: 'posts',
    sort: 'publishedAt',
    order: 'desc',
    limit: 20,
    depth: 1,
    overrideAccess: false,
    user: null
  });

  return { data: posts.docs.map(toPostSummary) };
});
