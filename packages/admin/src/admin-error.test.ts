import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  ForgeApiError
} from '@forge-cms/angular';
import { describeAdminError, describeSessionError } from './admin-error.js';

const http = (status: number, code = 'X') =>
  new ForgeApiError({ kind: 'http', status, code, message: `Failed: ${status}` });

describe('describeAdminError', () => {
  it('maps a validation error to the field hint', () => {
    expect(describeAdminError(new ApiValidationError('Invalid', []))).toBe(
      'Fix the highlighted fields and try again.'
    );
  });

  it('maps a 401 to sign in again', () => {
    expect(describeAdminError(new ApiAuthError())).toBe(
      "You're not signed in, or your session expired. Please sign in again."
    );
  });

  it('reads the structured status (spec 075), not the message text', () => {
    expect(describeAdminError(http(403))).toBe("You don't have permission to do this.");
    expect(describeAdminError(http(404))).toBe('This document no longer exists.');
    expect(describeAdminError(http(500))).toBe(
      'Something went wrong on the server. Please try again.'
    );
    expect(describeAdminError(http(429))).toBe('Too many requests. Wait a moment and try again.');
    expect(describeAdminError(new Error('Failed to delete document: 403'))).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('shows the server message for a 409 conflict', () => {
    expect(
      describeAdminError(
        new ForgeApiError({
          kind: 'http',
          status: 409,
          code: 'UNIQUE_CONSTRAINT',
          message: 'Slug already exists'
        })
      )
    ).toBe('Slug already exists');
  });

  it('distinguishes network, aborted and malformed responses', () => {
    expect(
      describeAdminError(
        new ForgeApiError({ kind: 'network', code: 'NETWORK_ERROR', message: 'x' })
      )
    ).toContain("Couldn't reach the server");
    expect(
      describeAdminError(
        new ForgeApiError({ kind: 'invalid-response', code: 'INVALID_RESPONSE', message: 'x' })
      )
    ).toContain('unexpected response');
  });

  it('falls back for anything else', () => {
    expect(describeAdminError('not even an Error')).toBe('Something went wrong. Please try again.');
  });
});

describe('describeSessionError', () => {
  it("shows the server's curated auth message", () => {
    expect(
      describeSessionError(
        new ApiAuthActionError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
      )
    ).toBe('Invalid email or password');
  });

  it('never presents an outage as a credential problem', () => {
    expect(
      describeSessionError(
        new ForgeApiError({ kind: 'network', code: 'NETWORK_ERROR', message: 'x' })
      )
    ).toContain("Couldn't reach the server");
  });
});
