import { cleanText } from './project-reader.js';

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

export interface RuntimeMetadataResult {
  origin: string;
  collections: {
    slug: string;
    label?: string;
    fields: { name: string; type: string; localized?: boolean }[];
  }[];
}

/** Validates the caller-supplied origin: http(s) only, no credentials, no path/query. */
export function parseOrigin(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('origin must be an absolute http(s) URL such as http://localhost:4200');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('origin must use http or https');
  if (url.username !== '' || url.password !== '')
    throw new Error('origin must not contain credentials');
  return new URL(url.origin);
}

/**
 * Reads the SANITIZED public metadata (`GET /api/v1/collections`) of a running Forge application, anonymously:
 * GET only, no cookies, no tokens, no redirects, bounded time and size. No private introspection endpoint exists
 * for this; the anonymous endpoint is exactly what any browser can read.
 */
export async function fetchRuntimeMetadata(
  origin: string,
  fetchImpl: typeof fetch = fetch
): Promise<RuntimeMetadataResult> {
  const base = parseOrigin(origin);
  const target = new URL('/api/v1/collections', base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`the application answered HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('the metadata response is too large');
    const body = JSON.parse(text) as { data?: unknown };
    const list = Array.isArray(body.data) ? body.data : [];
    return {
      origin: base.origin,
      collections: list.slice(0, 100).map((raw) => {
        const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
          string,
          unknown
        >;
        const fields = Array.isArray(item['fields']) ? item['fields'] : [];
        return {
          slug: cleanText(item['slug'], 80),
          ...(typeof item['label'] === 'string' && { label: cleanText(item['label'], 80) }),
          fields: fields.slice(0, 200).map((f) => {
            const field = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
            return {
              name: cleanText(field['name'], 80),
              type: cleanText(field['type'], 40),
              ...(field['localized'] === true && { localized: true })
            };
          })
        };
      })
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'the request timed out'
        : error instanceof Error
          ? error.message
          : 'request failed';
    throw new Error(
      `Could not read runtime metadata from ${base.origin}: ${cleanText(message, 160)}`
    );
  } finally {
    clearTimeout(timer);
  }
}
