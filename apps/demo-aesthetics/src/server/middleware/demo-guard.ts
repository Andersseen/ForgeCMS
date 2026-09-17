import { createError, defineEventHandler, getRequestHeader } from 'h3';
import { MAX_BODY_BYTES, MAX_UPLOAD_BYTES, throttleWrite } from '../api/demo-limits';

/**
 * The front door of the public demo.
 *
 * Reads pass straight through — they are cached and cheap. Writes are what cost money and what can
 * ruin the demo for the next visitor, so they are throttled per IP, capped in size, and forbidden
 * outright where they would let someone lock the clinic out of its own CMS.
 *
 * This is not security: the demo publishes its own admin password on purpose. It is a spending
 * limit, and it lives here rather than in the CMS because it is a property of *this deployment*,
 * not of ForgeCMS.
 */

/** Account management is off: nobody can add a login, and nobody can delete the demo admin. */
const FROZEN_PATHS = ['/api/auth/users'];

/**
 * Forge Analytics (spec 057)'s collector is a `POST` but not a *mutation* in the sense this guard
 * exists for — it never touches D1/R2, it goes to a separate, effectively-free Analytics Engine
 * quota, and one visitor's page navigations legitimately fire several of these per minute. Sharing
 * `throttleWrite`'s budget with real content writes starved actual signups/logins under load (caught
 * by this app's own e2e suite once the tracker started running on every page). The body-size cap
 * below still applies — this only exempts the write-count throttle.
 */
const UNTHROTTLED_WRITE_PATHS = ['/api/analytics/collect'];

export default defineEventHandler((event) => {
  const path = event.path ?? '';
  if (!path.startsWith('/api/')) return;

  const method = (event.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  if (FROZEN_PATHS.some((frozen) => path.startsWith(frozen))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User management is disabled in the demo. Sign in with the published accounts.'
    });
  }

  const contentType = getRequestHeader(event, 'content-type') ?? '';
  const isUpload = contentType.includes('multipart/form-data');
  const limit = isUpload ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES;
  const declared = Number(getRequestHeader(event, 'content-length') ?? 0);

  if (Number.isFinite(declared) && declared > limit) {
    throw createError({
      statusCode: 413,
      statusMessage: isUpload
        ? `Files in the demo are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
        : 'That payload is larger than the demo accepts.'
    });
  }

  if (UNTHROTTLED_WRITE_PATHS.some((exempt) => path.startsWith(exempt))) return;

  // `cf-connecting-ip` is set by Cloudflare and cannot be spoofed by the client; the fallbacks only
  // matter for local development, where a single bucket is fine.
  const ip =
    getRequestHeader(event, 'cf-connecting-ip') ??
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    'local';

  const { allowed, retryAfter } = throttleWrite(ip);
  if (!allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many changes at once. Try again in ${retryAfter}s — this is a shared demo.`,
      data: { retryAfter }
    });
  }
});
