import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';
import { populateUploads } from '../../../api/uploads';
import { toCategory, toServiceSummary } from '../../../api/mappers';
import type { ServicesPayload } from '../../../../shared/site-content';

/** The treatment menu: every published service, plus the categories to group them by. */
export default defineEventHandler(async (event): Promise<{ data: ServicesPayload }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
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

  const withImages = await populateUploads(runtime, services.docs, ['image']);

  return {
    data: {
      services: withImages.map(toServiceSummary),
      categories: categories.docs
        .map(toCategory)
        .filter((category): category is NonNullable<typeof category> => category !== null)
    }
  };
});
