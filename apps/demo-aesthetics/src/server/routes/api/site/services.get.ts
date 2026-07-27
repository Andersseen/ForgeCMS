import { definePublicSiteRoute } from '../../../api/public-route';
import { toCategory, toServiceSummary } from '../../../api/mappers';
import type { ServicesPayload } from '../../../../shared/site-content';

/** The treatment menu: every published service, plus the categories to group them by. */
export default definePublicSiteRoute(async (runtime): Promise<ServicesPayload> => {
  const asVisitor = { overrideAccess: false, user: null } as const;

  const [services, categories] = await Promise.all([
    runtime.find({
      collection: 'services',
      sort: 'order',
      order: 'asc',
      limit: 50,
      depth: 1,
      ...asVisitor
    }),
    runtime.find({
      collection: 'service_categories',
      sort: 'order',
      order: 'asc',
      limit: 20,
      ...asVisitor
    })
  ]);

  return {
    services: services.docs.map(toServiceSummary),
    categories: categories.docs
      .map(toCategory)
      .filter((category): category is NonNullable<typeof category> => category !== null)
  };
});
