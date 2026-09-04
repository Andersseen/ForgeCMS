const ADMIN_ROOT = '/admin';
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
 * only same-app `/admin` paths so a crafted query string cannot turn sign-in into an open redirect.
 */
export function safeAdminRedirect(value: string | null | undefined, fallback = ADMIN_ROOT): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (candidate.includes('\\') || hasControlCharacter(candidate)) return fallback;

  try {
    const parsed = new URL(candidate, SAME_APP_ORIGIN);
    if (parsed.origin !== SAME_APP_ORIGIN) return fallback;
    if (parsed.pathname !== ADMIN_ROOT && !parsed.pathname.startsWith(`${ADMIN_ROOT}/`)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
