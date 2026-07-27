import { createError, defineEventHandler, getRouterParam } from 'h3';
import { getServerRuntime } from '../../../../api/runtime';
import { populateUploads } from '../../../../api/uploads';
import { toPostDetail } from '../../../../api/mappers';
import type { PostDetail } from '../../../../../shared/site-content';

/** One journal entry. Drafts 404 for anonymous readers, which is spec 017 doing its job. */
export default defineEventHandler(async (event): Promise<{ data: PostDetail }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const slug = getRouterParam(event, 'slug') ?? '';

  const found = await runtime.find({
    collection: 'posts',
    where: { slug },
    limit: 1,
    depth: 1,
    overrideAccess: false,
    user: null
  });

  const [record] = found.docs;
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Post not found' });
  }

  const [withCover] = await populateUploads(runtime, [record], ['coverImage']);
  return { data: toPostDetail(withCover ?? record) };
});
