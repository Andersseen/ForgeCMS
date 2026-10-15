import { createError, defineEventHandler, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import {
  MAX_BODY_BYTES,
  MAX_UPLOAD_BYTES,
  PUBLIC_DAILY_BUDGETS,
  PUBLIC_LIMITERS,
  PUBLIC_MAX_BODY_BYTES,
  throttleWrite
} from '../api/demo-limits';
import {
  DEMO_MESSAGES,
  decide,
  getBudgetStore,
  resolveDemoMode,
  type BudgetedClass,
  type DemoDenialCode
} from '../api/demo-policy';

/**
 * The front door of the demo.
 *
 * Reads pass straight through — they are cached and cheap (in the shared public demo, script-grade
 * volumes of API reads are throttled too). Writes are what cost money and what can ruin the demo for
 * the next visitor. Two modes (`demo-policy.ts`):
 *
 * - **full** — the maintainer's / local / e2e demo: size caps, a per-IP write throttle, and the frozen
 *   account paths. Everything Forge supports works.
 * - **public** (`FORGE_PUBLIC_DEMO=1`) — the hosted example: an allowlist of mutations, each class with
 *   its own per-IP limiter and, for the ones that reach D1, a global daily budget that holds across
 *   every isolate and fails closed.
 *
 * This is not security: the demo publishes its own admin password on purpose. It is a spending limit,
 * and it lives here rather than in the CMS because it is a property of *this deployment*, not of
 * ForgeCMS.
 */

/** Account management is off in every mode: nobody can add a login, and nobody can delete the admin. */
const FROZEN_PATHS = ['/api/auth/users'];

/**
 * Forge Analytics (spec 057)'s collector is a `POST` but not a *mutation* in the sense the content
 * throttle exists for — it never touches D1/R2 and goes to a separate Analytics Engine dataset, and
 * one visitor's navigations legitimately fire several per minute. In full mode it only gets the body
 * cap; in public mode it has its own limiter (`PUBLIC_LIMITERS.ANALYTICS_COLLECT`).
 */
const UNTHROTTLED_WRITE_PATHS = ['/api/analytics/collect'];

/** Read paths that are cheap and cached, or are the deployment probe. */
const UNTHROTTLED_READ_PREFIXES = ['/api/site/', '/api/status', '/api/demo-policy', '/api/media/'];

/**
 * `cf-connecting-ip` is set by Cloudflare and cannot be spoofed by the client; the fallbacks only
 * matter for local development, where a single bucket is fine. Used as an in-memory key only — it is
 * never stored.
 */
function clientKey(event: H3Event): string {
  return (
    getRequestHeader(event, 'cf-connecting-ip') ??
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

function refuse(status: number, code: DemoDenialCode, retryAfter?: number): never {
  throw createError({
    statusCode: status,
    statusMessage: DEMO_MESSAGES[code],
    data: { code, demo: true, ...(retryAfter !== undefined && { retryAfter }) }
  });
}

export default defineEventHandler(async (event) => {
  const path = event.path ?? '';
  if (!path.startsWith('/api/')) return;

  const env = event.context.cloudflare?.env;
  const mode = resolveDemoMode(env);
  const method = (event.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS' || method === 'HEAD') return;

  if (method === 'GET') {
    if (mode === 'public' && !UNTHROTTLED_READ_PREFIXES.some((p) => path.startsWith(p))) {
      const { allowed, retryAfter } = PUBLIC_LIMITERS.API_READ.hit(clientKey(event));
      if (!allowed) refuse(429, 'demo_rate_limited', retryAfter);
    }
    return;
  }

  if (FROZEN_PATHS.some((frozen) => path.startsWith(frozen))) {
    throw createError({
      statusCode: 403,
      statusMessage: DEMO_MESSAGES.demo_accounts_disabled,
      data: { code: 'demo_accounts_disabled', demo: true }
    });
  }

  const contentType = getRequestHeader(event, 'content-type') ?? '';
  const isUpload = contentType.includes('multipart/form-data');
  const declaredHeader = getRequestHeader(event, 'content-length');
  const declared = Number(declaredHeader ?? 0);

  if (mode === 'public') return enforcePublic(event, path, method, declaredHeader, declared, env);

  const limit = isUpload ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES;
  if (Number.isFinite(declared) && declared > limit) {
    throw createError({
      statusCode: 413,
      statusMessage: isUpload
        ? `Files in the demo are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
        : 'That payload is larger than the demo accepts.',
      data: { demo: true, code: 'demo_payload_too_large' }
    });
  }

  if (UNTHROTTLED_WRITE_PATHS.some((exempt) => path.startsWith(exempt))) return;

  const { allowed, retryAfter } = throttleWrite(clientKey(event));
  if (!allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many changes at once. Try again in ${retryAfter}s - this is a shared demo.`,
      data: { retryAfter, demo: true, code: 'demo_rate_limited' }
    });
  }
});

async function enforcePublic(
  event: H3Event,
  path: string,
  method: string,
  declaredHeader: string | undefined,
  declared: number,
  env: Parameters<typeof getBudgetStore>[0] & { FORGE_PUBLIC_DEMO?: string }
): Promise<void> {
  const decision = decide(method, path);
  if (decision.action === 'deny') refuse(decision.status, decision.code);
  if (decision.cls === 'PASS') return;

  // Small bodies only, and a declared length: a streamed body with no length is refused rather than
  // trusted, because the cap is checked before any of it is read.
  if (
    declaredHeader === undefined ||
    !Number.isFinite(declared) ||
    declared > PUBLIC_MAX_BODY_BYTES
  ) {
    refuse(413, 'demo_payload_too_large');
  }

  const ip = clientKey(event);
  const { allowed, retryAfter } = PUBLIC_LIMITERS[decision.cls].hit(ip);
  if (!allowed) refuse(429, 'demo_rate_limited', retryAfter);

  if (decision.cls === 'CONTENT_UPDATE' || decision.cls === 'BOOKING_CREATE') {
    const cls: BudgetedClass = decision.cls;
    const result = await getBudgetStore(env).consume(cls, PUBLIC_DAILY_BUDGETS[cls]);
    if (!result.allowed) {
      refuse(
        result.reason === 'unavailable' ? 503 : 429,
        result.reason === 'unavailable' ? 'demo_budget_unavailable' : 'demo_budget_exhausted'
      );
    }
  }
}
