import { CANONICAL_ORIGIN } from './site-config.mjs';

/** Canonical paths have no query, fragment, or trailing slash (except the site root). */
export function canonicalUrl(input: string): string {
  const url = new URL(input, CANONICAL_ORIGIN);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
  return `${CANONICAL_ORIGIN}${path}`;
}
