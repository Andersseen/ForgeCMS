import { DEFAULT_ADMIN_BASE_PATH, isUnderPath, normalizeAdminBasePath } from './mount-path.js';

const SAME_APP_ORIGIN = 'https://forge.local';

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Keeps auth return URLs inside the admin area of the current app.
 *
 * Angular's `navigateByUrl()` accepts absolute and protocol-relative strings; this helper accepts
 * only same-app paths under the admin mount root (`/admin` unless `root` says otherwise) so a crafted
 * query string cannot turn sign-in into an open redirect. `/studio-evil` is not under `/studio`.
 */
export function safeAdminRedirect(
  value: string | null | undefined,
  fallback: string = DEFAULT_ADMIN_BASE_PATH,
  root: string = DEFAULT_ADMIN_BASE_PATH
): string {
  const adminRoot = normalizeAdminBasePath(root);
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (candidate.includes('\\') || hasControlCharacter(candidate)) return fallback;

  try {
    const parsed = new URL(candidate, SAME_APP_ORIGIN);
    if (parsed.origin !== SAME_APP_ORIGIN) return fallback;
    if (!isUnderPath(parsed.pathname, adminRoot)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
