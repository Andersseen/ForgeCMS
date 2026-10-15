import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  credentialBoundary,
  publicTransferPolicy,
  registerCredentialBoundary,
  registerPublicTransferPolicy
} from './credentials.js';

describe('credential boundary registry', () => {
  it('a stand-in service gets a stable static boundary of its own', () => {
    const owner = {};
    const first = credentialBoundary(owner);
    expect(credentialBoundary(owner)).toBe(first);
    expect(credentialBoundary({})).not.toBe(first);
    const before = first.revision();
    first.invalidate();
    expect(first.revision()).not.toBe(before);
  });

  it('a registered boundary follows its token and its invalidations', () => {
    let token: string | null = 'a';
    const owner = {};
    registerCredentialBoundary(owner, () => token);
    const boundary = credentialBoundary(owner);
    const one = boundary.revision();
    expect(boundary.revision()).toBe(one);
    boundary.invalidate();
    expect(boundary.revision()).not.toBe(one);
    token = 'b';
    expect(boundary.revision()).toBeDefined();
  });
});

describe('public transfer policy registry', () => {
  it('is not eligible unless the owner registered one', () => {
    expect(publicTransferPolicy({})).toEqual({ eligible: false, namespace: '' });
    const owner = {};
    registerPublicTransferPolicy(owner, { eligible: true, namespace: '/api/v1' });
    expect(publicTransferPolicy(owner)).toEqual({ eligible: true, namespace: '/api/v1' });
  });
});
