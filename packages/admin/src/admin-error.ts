import {
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  ForgeApiError
} from '@forge-cms/angular';

/**
 * Turns whatever `CmsApiService` throws into a message an editor can read — never raw JSON or a
 * stack trace (spec 052 §19). Field-level validation messages are handled separately, next to each
 * `ForgeFieldControl`; this covers the whole-request failure. Reads the structured `ForgeApiError`
 * (spec 075) instead of parsing a status out of the message.
 */
export function describeAdminError(error: unknown): string {
  if (error instanceof ApiValidationError) {
    return 'Fix the highlighted fields and try again.';
  }
  if (error instanceof ApiAuthError) {
    return "You're not signed in, or your session expired. Please sign in again.";
  }
  if (error instanceof ForgeApiError) {
    if (error.kind === 'network')
      return "Couldn't reach the server. Check your connection and try again.";
    if (error.kind === 'aborted') return 'The request was cancelled.';
    if (error.kind === 'invalid-response') {
      return 'The server sent an unexpected response. Please try again.';
    }
    if (error.status === 403) return "You don't have permission to do this.";
    if (error.status === 404) return 'This document no longer exists.';
    if (error.status === 409) return error.message;
    if (error.status === 413) return 'That is too large to upload.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (error.status !== undefined && error.status >= 500) {
      return 'Something went wrong on the server. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

/**
 * The message a sign-in/sign-up form shows for `ForgeAuthSession.error()`: the server's curated auth
 * text for a rejected login (spec 053), otherwise the generic mapping above — an outage never renders
 * as "wrong password", and a failed logout stays visible.
 */
export function describeSessionError(error: unknown): string {
  if (error instanceof ApiAuthActionError) return error.message;
  return describeAdminError(error);
}
