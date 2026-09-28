import { definePublicSiteRoute } from '../../../api/public-route';
import {
  toPageContent,
  toPromotion,
  toServiceSummary,
  toSiteSettings,
  toTestimonial
} from '../../../api/mappers';
import type { HomePayload } from '../../../../shared/site-content';

/**
 * Everything the home page needs, in one request.
 *
 * This is the Local API doing what the roadmap thesis promises: five collections composed on the
 * server with no HTTP hop, no fabricated `Request`, and no over-fetching on the client. Each call
 * passes `overrideAccess: false` with `user: null` so the public site is subject to exactly the
 * access and draft rules an anonymous visitor would hit.
 */
export default definePublicSiteRoute(async (runtime): Promise<HomePayload> => {
  const asVisitor = { overrideAccess: false, user: null } as const;

  const [page, services, testimonials, promotions, siteSettings] = await Promise.all([
    runtime.findOne({ collection: 'pages', where: { slug: 'home' }, ...asVisitor }),
    runtime.find({
      collection: 'services',
      where: { featured: true },
      sort: 'order',
      order: 'asc',
      limit: 6,
      depth: 1,
      ...asVisitor
    }),
    runtime.find({ collection: 'testimonials', limit: 6, depth: 1, ...asVisitor }),
    // The access rule on `promotions` already limits anonymous callers to `active: true` ones.
    runtime.find({ collection: 'promotions', limit: 1, ...asVisitor }),
    // A one-row collection rather than a global — see `settings.get.ts` for why (finding 4).
    runtime.findOne({ collection: 'site_settings', ...asVisitor })
  ]);

  const [promotion] = promotions.docs;

  return {
    page: page ? toPageContent(page) : null,
    featuredServices: services.docs.map(toServiceSummary),
    testimonials: testimonials.docs.map(toTestimonial),
    promotion: promotion ? toPromotion(promotion) : null,
    settings: siteSettings ? toSiteSettings(siteSettings) : null
  };
});
