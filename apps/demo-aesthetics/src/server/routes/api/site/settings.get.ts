import { definePublicSiteRoute } from '../../../api/public-route';
import { toSiteSettings } from '../../../api/mappers';
import type { SiteSettings } from '../../../../shared/site-content';

/**
 * The site-wide settings, read from a collection that holds one row.
 *
 * FINDING 4, now a deliberate retention: ForgeCMS has globals (roadmap 023, spec 066), but the
 * deployed demo's D1 keeps the clinic's edited settings in the `site_settings` table. A global lives
 * in its own `_global_site_settings` table, which schema sync would create *empty* — moving the row
 * across is a data migration, and reviewed migrations are roadmap 0.7 M02. Until then the demo keeps
 * this shape; `findOne` at least makes "the one row" explicit.
 */
export default definePublicSiteRoute(async (runtime): Promise<SiteSettings | null> => {
  const record = await runtime.findOne({
    collection: 'site_settings',
    overrideAccess: false,
    user: null
  });
  return record ? toSiteSettings(record) : null;
});
