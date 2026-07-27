import { definePublicSiteRoute } from '../../../api/public-route';
import { toSiteSettings } from '../../../api/mappers';
import type { SiteSettings } from '../../../../shared/site-content';

/**
 * The site-wide settings "global". It is a normal collection expected to hold one row, so this
 * endpoint picks `docs[0]` and hopes nobody created a second one (finding 4).
 */
export default definePublicSiteRoute(async (runtime): Promise<SiteSettings | null> => {
  const found = await runtime.find({
    collection: 'site_settings',
    limit: 1,
    overrideAccess: false,
    user: null
  });

  const [record] = found.docs;
  return record ? toSiteSettings(record) : null;
});
