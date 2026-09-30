import { pathToFileURL } from 'node:url';

/**
 * Post-deploy health gate for the two public Cloudflare Pages apps (spec 075; replaces spec 074's
 * demo-only `verify-demo-deployment.mjs`). Repository tooling only — not a Forge package API.
 *
 *   node scripts/verify-deployment.mjs www|demo
 *
 * Each endpoint is polled with a bounded number of attempts and a per-request timeout, and must return
 * the expected status with a payload its validator accepts. A static site that uploaded but whose API
 * answers 500 is a failed deployment. Output names the profile, endpoint, attempt, status and — for
 * Forge's own error envelope only — its code, message and startup stage; other bodies (Cloudflare error
 * pages, HTML) are never printed. Nothing here reads or prints a credential.
 */

export const RUNBOOK = 'docs/DEPLOYMENT-HEALTH.md';

const isObject = (value) => typeof value === 'object' && value !== null;
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const count = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** `/api/status` of apps/demo-aesthetics: adapter names plus per-collection counts. */
export function isHealthyDemoStatus(body) {
  const data = isObject(body) ? body.data : undefined;
  return (
    isObject(data) &&
    nonEmptyString(data.database) &&
    nonEmptyString(data.auth) &&
    nonEmptyString(data.storage) &&
    isObject(data.collections) &&
    Object.keys(data.collections).length > 0 &&
    Object.values(data.collections).every(count)
  );
}

/** `/api/status` of apps/www: `{ database: { name, records }, auth: { name }, storage: { name }, api }`. */
export function isHealthyWwwStatus(body) {
  const data = isObject(body) ? body.data : undefined;
  return (
    isObject(data) &&
    isObject(data.database) &&
    nonEmptyString(data.database.name) &&
    count(data.database.records) &&
    isObject(data.auth) &&
    nonEmptyString(data.auth.name) &&
    isObject(data.storage) &&
    nonEmptyString(data.storage.name) &&
    isObject(data.api) &&
    data.api.status === 'online'
  );
}

/** `/api/site/home`: real content, not an empty shell. */
export function isPopulatedDemoHome(body) {
  const data = isObject(body) ? body.data : undefined;
  return (
    isObject(data) &&
    Array.isArray(data.featuredServices) &&
    data.featuredServices.length > 0 &&
    isObject(data.settings) &&
    nonEmptyString(data.settings.clinicName)
  );
}

/** `/api/site/settings`: the clinic's one settings row. */
export function isPopulatedDemoSettings(body) {
  const data = isObject(body) ? body.data : undefined;
  return isObject(data) && nonEmptyString(data.clinicName) && nonEmptyString(data.email);
}

/** `/api/v1/collections` of apps/www: the public collection metadata list. */
export function isCollectionList(body) {
  return isObject(body) && Array.isArray(body.data) && body.data.length > 0;
}

export const PROFILES = {
  www: {
    name: 'official site (forge-cms)',
    origin: 'https://forge-cms.pages.dev',
    endpoints: [
      { path: '/api/status', validate: isHealthyWwwStatus },
      { path: '/api/v1/collections', validate: isCollectionList }
    ]
  },
  demo: {
    name: 'Lumea demo (forge-cms-demo)',
    origin: 'https://forge-cms-demo.pages.dev',
    endpoints: [
      { path: '/api/status', validate: isHealthyDemoStatus },
      { path: '/api/site/home', validate: isPopulatedDemoHome },
      { path: '/api/site/settings', validate: isPopulatedDemoSettings }
    ]
  }
};

/**
 * A one-line, safe description of a failed response. Only Forge's JSON error envelope contributes
 * text, and each field is truncated; any other body is summarized by its content type alone.
 */
export async function describeFailure(response) {
  const type = response.headers.get('content-type') ?? 'unknown content type';
  if (!type.includes('application/json')) return `HTTP ${response.status} (${type.split(';')[0]})`;
  let body;
  try {
    body = await response.json();
  } catch {
    return `HTTP ${response.status} (invalid JSON)`;
  }
  const clip = (value) => String(value).slice(0, 160);
  const error = isObject(body) ? body.error : undefined;
  if (isObject(error)) {
    const parts = [error.code, error.message].filter(nonEmptyString).map(clip);
    const details = isObject(error.details) ? error.details : {};
    if (nonEmptyString(details.stage)) parts.push(`stage=${clip(details.stage)}`);
    if (nonEmptyString(details.reason)) parts.push(`reason=${clip(details.reason)}`);
    return `HTTP ${response.status} ${parts.join(' — ')}`.trim();
  }
  // h3's generic `{ statusCode, statusMessage }` — the opaque 500 an unhandled startup error produces.
  if (isObject(body) && nonEmptyString(body.statusMessage)) {
    return `HTTP ${response.status} ${clip(body.statusMessage)} (no Forge diagnostics in body)`;
  }
  return `HTTP ${response.status}`;
}

async function checkEndpoint(url, endpoint, { attempts, delayMs, timeoutMs, fetchImpl, log }) {
  const expected = endpoint.status ?? 200;
  let lastFailure = 'no request was made';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status !== expected) {
        lastFailure = await describeFailure(response);
      } else {
        let body;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        if (endpoint.validate === undefined || endpoint.validate(body)) {
          log(`  ✓ ${endpoint.path} — HTTP ${response.status} on attempt ${attempt}/${attempts}`);
          return { ok: true };
        }
        lastFailure = `HTTP ${response.status} with a payload that failed validation`;
      }
    } catch (error) {
      lastFailure =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timed out after ${timeoutMs} ms`
          : `request failed: ${error instanceof Error ? error.name : 'unknown error'}`;
    }
    log(`  ✗ ${endpoint.path} — attempt ${attempt}/${attempts}: ${lastFailure}`);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { ok: false, failure: lastFailure };
}

/**
 * Verifies every endpoint of one deployment. Resolves when all pass; rejects with a summary naming
 * each failed endpoint and the runbook otherwise.
 */
export async function verifyDeployment({
  name,
  origin,
  endpoints,
  attempts = 12,
  delayMs = 5_000,
  timeoutMs = 10_000,
  fetchImpl = fetch,
  log = console.log
}) {
  log(`Verifying ${name} at ${origin}`);
  const failures = [];
  for (const endpoint of endpoints) {
    const result = await checkEndpoint(new URL(endpoint.path, origin).href, endpoint, {
      attempts,
      delayMs,
      timeoutMs,
      fetchImpl,
      log
    });
    if (!result.ok) {
      failures.push(`${endpoint.path}: ${result.failure}`);
      // Once status is down, the content endpoints only repeat the same startup failure.
      if (endpoint.path === '/api/status') break;
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${name} is not healthy.\n  ${failures.join('\n  ')}\nSee ${RUNBOOK} for the operator runbook.`
    );
  }
  log(`${name} is healthy.`);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const key = process.argv[2];
  const profile = PROFILES[key];
  if (profile === undefined) {
    console.error(`Usage: node scripts/verify-deployment.mjs <${Object.keys(PROFILES).join('|')}>`);
    process.exit(2);
  }
  try {
    await verifyDeployment({
      ...profile,
      ...(process.env.DEPLOY_HEALTH_ORIGIN && { origin: process.env.DEPLOY_HEALTH_ORIGIN }),
      ...(process.env.DEPLOY_HEALTH_ATTEMPTS && {
        attempts: Number(process.env.DEPLOY_HEALTH_ATTEMPTS)
      })
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
