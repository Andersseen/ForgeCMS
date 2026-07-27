import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';
import { toSiteSettings } from '../../../api/mappers';
import type { SiteSettings } from '../../../../shared/site-content';

/**
 * The site-wide settings "global". It is a normal collection expected to hold one row, so this
 * endpoint picks `docs[0]` and hopes nobody created a second one (finding 4).
 */
export default defineEventHandler(async (event): Promise<{ data: SiteSettings | null }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  const found = await runtime.find({
    collection: 'site_settings',
    limit: 1,
    overrideAccess: false,
    user: null
  });

  const [record] = found.docs;
  return { data: record ? toSiteSettings(record) : null };
});
