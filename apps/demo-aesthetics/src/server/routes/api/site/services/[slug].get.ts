import { createError, getRouterParam } from 'h3';
import { definePublicSiteRoute } from '../../../../api/public-route';
import { loadServiceDetail } from '../../../../api/service-detail';
import type { ServiceDetailPayload } from '../../../../../shared/site-content';

/** One treatment, its siblings in the same category, and the specialists who perform it. */
export default definePublicSiteRoute(async (runtime, event): Promise<ServiceDetailPayload> => {
  const detail = await loadServiceDetail(runtime, getRouterParam(event, 'slug') ?? '');
  if (!detail) {
    throw createError({ statusCode: 404, statusMessage: 'Service not found' });
  }
  return detail;
});
