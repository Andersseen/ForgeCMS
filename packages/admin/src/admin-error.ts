import { ApiAuthError, ApiValidationError } from '@forge-cms/angular';

/**
 * `@forge-cms/angular`'s generic failures carry their status as a `"...: 404"` suffix (see
 * `api.service.ts`'s `toApiError`) rather than a typed subclass — only 401 gets one
 * (`ApiAuthError`). This recovers it without inventing a parallel error contract.
 */
function statusFromMessage(message: string): number | null {
  const match = /:\s*(\d{3})$/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Turns whatever `CmsApiService` throws into a message an editor can read — never raw JSON or a
 * stack trace (spec 052 §19). Field-level validation messages are handled separately, next to each
 * `ForgeFieldControl`; this covers the whole-request failure.
 */
export function describeAdminError(error: unknown): string {
  if (error instanceof ApiValidationError) {
    return 'Fix the highlighted fields and try again.';
  }
  if (error instanceof ApiAuthError) {
    return "You're not signed in, or your session expired. Please sign in again.";
  }
  if (error instanceof Error) {
    const status = statusFromMessage(error.message);
    if (status === 403) return "You don't have permission to do this.";
    if (status === 404) return 'This document no longer exists.';
    if (status !== null && status >= 500) {
      return 'Something went wrong on the server. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
