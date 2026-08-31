import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiAuthError, ApiValidationError } from '@forge-cms/angular';
import { describeAdminError } from './admin-error.js';

describe('describeAdminError', () => {
  it('maps a validation error to a fix-the-fields message', () => {
    expect(describeAdminError(new ApiValidationError('Invalid', []))).toBe(
      'Fix the highlighted fields and try again.'
    );
  });

  it('maps an auth error to a sign-in-again message', () => {
    expect(describeAdminError(new ApiAuthError())).toBe(
      "You're not signed in, or your session expired. Please sign in again."
    );
  });

  it('maps a 403 to a permission message', () => {
    expect(describeAdminError(new Error('Failed to delete document: 403'))).toBe(
      "You don't have permission to do this."
    );
  });

  it('maps a 404 to a not-found message', () => {
    expect(describeAdminError(new Error('Failed to fetch document: 404'))).toBe(
      'This document no longer exists.'
    );
  });

  it('maps a 5xx to a server-error message', () => {
    expect(describeAdminError(new Error('Failed to create document: 500'))).toBe(
      'Something went wrong on the server. Please try again.'
    );
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeAdminError(new Error('network error'))).toBe(
      'Something went wrong. Please try again.'
    );
    expect(describeAdminError('not even an Error')).toBe('Something went wrong. Please try again.');
  });
});
