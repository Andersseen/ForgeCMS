import { definePublicSiteRoute } from '../../../api/public-route';
import { toPostSummary } from '../../../api/mappers';
import type { PostSummary } from '../../../../shared/site-content';

/** The journal index — published posts, newest first. */
export default definePublicSiteRoute(async (runtime): Promise<PostSummary[]> => {
  const posts = await runtime.find({
    collection: 'posts',
    sort: 'publishedAt',
    order: 'desc',
    limit: 20,
    depth: 1,
    overrideAccess: false,
    user: null
  });

  return posts.docs.map(toPostSummary);
});
