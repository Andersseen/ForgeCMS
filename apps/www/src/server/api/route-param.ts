import type { H3Event } from 'h3';
import { getRouterParam } from 'h3';

/**
 * A route parameter, percent-decoded as one path segment. `@forge-cms/angular` encodes every id and
 * slug with `encodeURIComponent` (spec 075), and h3's own `decode` option uses `decodeURI`, which
 * leaves `%2F`, `%3F`, `%23` and `%2B` encoded. `''` when the parameter is missing.
 */
export function routeParam(event: H3Event, name: string): string {
  const raw = getRouterParam(event, name);
  if (raw === undefined) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
