import { getRouterParam, toWebRequest, type H3Event } from 'h3';
import type { ApiContext } from '@forge-cms/api';

/** The framework-agnostic context every Forge handler takes, built from an h3 event. */
export function apiContext(event: H3Event, ...params: string[]): ApiContext {
  return {
    request: toWebRequest(event),
    // Ids and slugs arrive percent-encoded as one path segment.
    params: Object.fromEntries(
      params.map((name) => [name, decodeURIComponent(getRouterParam(event, name) ?? '')])
    ),
    env: undefined
  };
}

/** Session cookie options: `Secure` in production (serve it over HTTPS), plain for local development. */
export const sessionCookie = { secure: process.env['NODE_ENV'] === 'production' };
