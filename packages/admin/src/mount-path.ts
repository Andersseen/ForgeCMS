/** The default place a host mounts the reusable admin: `/admin`. */
export const DEFAULT_ADMIN_BASE_PATH = '/admin';

function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validates and normalises an admin mount root: a same-app absolute path such as `/admin`,
 * `/studio` or `/ops/cms`. Returns the path without a trailing slash, or `null` when it is not a
 * usable mount root (not absolute, protocol-relative, a URL, contains `?`/`#`/`\`/whitespace/control
 * characters, empty or `..` segments, or the bare app root `/`).
 */
export function parseAdminBasePath(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith('/')) return null;
  if (hasForbiddenCharacter(candidate) || /[\\?#]/.test(candidate)) return null;
  const segments = candidate.split('/').slice(1);
  if (segments[segments.length - 1] === '') segments.pop();
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return `/${segments.join('/')}`;
}

/** {@link parseAdminBasePath}, falling back to {@link DEFAULT_ADMIN_BASE_PATH} when unset/invalid. */
export function normalizeAdminBasePath(value: string | null | undefined): string {
  return parseAdminBasePath(value) ?? DEFAULT_ADMIN_BASE_PATH;
}

/** Whether `pathname` is exactly `root` or a real child segment of it (`/studio-evil` is neither). */
export function isUnderPath(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}
