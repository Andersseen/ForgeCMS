import { createError, getRouterParam } from 'h3';
import { definePublicSiteRoute } from '../../../../api/public-route';
import { toPostDetail } from '../../../../api/mappers';
import type { PostDetail } from '../../../../../shared/site-content';

/** One journal entry. Drafts 404 for anonymous readers, which is spec 017 doing its job. */
export default definePublicSiteRoute(async (runtime, event): Promise<PostDetail> => {
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

  return toPostDetail(record);
});
