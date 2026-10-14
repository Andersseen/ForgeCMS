import { createError, getRouterParam } from 'h3';
import { definePublicSiteRoute } from '../../../../api/public-route';
import { toNotice } from '../../../../api/mappers';
import { isSiteLocale, type Notice } from '../../../../../shared/site-content';

/**
 * The clinic's notices in one language (spec 094) — the demo's real Forge localization.
 *
 * The locale is a *path* segment, not a query string, on purpose: `definePublicSiteRoute` caches by
 * path, and only `en` / `es` are accepted, so the cache holds at most two entries however a visitor
 * crafts the URL. The read is the Local API with `locale` set, as an anonymous visitor
 * (`overrideAccess: false`, `user: null`), so a draft notice stays invisible in both languages.
 */
export default definePublicSiteRoute(async (runtime, event): Promise<Notice[]> => {
  const locale = getRouterParam(event, 'locale');
  if (!isSiteLocale(locale)) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const result = await runtime.find({
    collection: 'notices',
    locale,
    sort: 'created_at',
    order: 'desc',
    limit: 3,
    overrideAccess: false,
    user: null
  });
  return result.docs.map(toNotice);
});
