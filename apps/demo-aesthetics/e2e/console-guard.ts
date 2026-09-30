import type { Page } from '@playwright/test';

/**
 * Collects unexpected browser errors for one page (spec 075): `console.error`, uncaught exceptions and
 * unhandled rejections. Allowlist, each proven harmless:
 *
 * - Chromium's own network log line for the anonymous session check, `GET /api/auth/me` → `401`:
 *   that 401 *is* the answer "nobody is signed in" (spec 075 keeps it distinct from an outage).
 * - Any failed-resource line, only in tests that deliberately produce one (`allowFailedResources`).
 */
export function guardConsole(page: Page, options: { allowFailedResources?: boolean } = {}) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.startsWith('Failed to load resource')) {
      problems.push(`console.error: ${text}`);
      return;
    }
    if (options.allowFailedResources) return;
    const anonymousSessionCheck =
      text.includes('status of 401') && message.location().url.endsWith('/api/auth/me');
    if (anonymousSessionCheck) return;
    problems.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}
