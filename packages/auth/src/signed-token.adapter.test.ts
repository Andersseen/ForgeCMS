import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { DEMO_CREDENTIALS, SignedTokenAuthAdapter } from './signed-token.adapter.js';

function createAdapter() {
  return new SignedTokenAuthAdapter({ devMode: true }).init();
}

const contractToken = await new SignedTokenAuthAdapter({ devMode: true })
  .init()
  .issueToken({ id: 'user-1', email: 'user@example.com', roles: ['admin'] });

function setupAuthenticatedRequest(_adapter: SignedTokenAuthAdapter) {
  return new Request('https://forge.test', {
    headers: { authorization: `Bearer ${contractToken}` }
  });
}

runAuthAdapterContractTests(createAdapter, setupAuthenticatedRequest);

describe('SignedTokenAuthAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('init() throws without AUTH_SECRET or devMode', () => {
    expect(() => new SignedTokenAuthAdapter().init()).toThrow(
      'SignedTokenAuthAdapter requires AUTH_SECRET to be set'
    );
  });

  it('init() succeeds with devMode', () => {
    expect(() => new SignedTokenAuthAdapter({ devMode: true }).init()).not.toThrow();
  });

  it('init() succeeds with AUTH_SECRET', () => {
    expect(() => new SignedTokenAuthAdapter().init({ AUTH_SECRET: 'test-secret' })).not.toThrow();
  });

  it('login() succeeds with the published demo credentials', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const result = await adapter.login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe(DEMO_CREDENTIALS.email);
    expect(typeof result?.token).toBe('string');
  });

  it('login() rejects an incorrect password', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const result = await adapter.login(DEMO_CREDENTIALS.email, 'wrong-password');
    expect(result).toBeNull();
  });

  it('login() rejects an unknown email', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const result = await adapter.login('nobody@example.com', DEMO_CREDENTIALS.password);
    expect(result).toBeNull();
  });

  it('a token issued via login() authenticates a subsequent request', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const login = await adapter.login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${login?.token}` }
    });
    const user = await adapter.requireAuth(request);
    expect(user.email).toBe(DEMO_CREDENTIALS.email);
  });

  it('rejects an expired token', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const token = await adapter.issueToken({ id: 'user-1' });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

    const session = await adapter.validateSession(token);
    expect(session).toBeNull();
  });

  it('rejects a token with a tampered signature', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const token = await adapter.issueToken({ id: 'user-1' });
    const [payloadPart, signaturePart] = token.split('.');
    const flippedChar = signaturePart?.[0] === 'a' ? 'b' : 'a';
    const tampered = `${payloadPart}.${flippedChar}${signaturePart?.slice(1)}`;

    const session = await adapter.validateSession(tampered);
    expect(session).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    expect(await adapter.validateSession('not-a-valid-token')).toBeNull();
    expect(await adapter.validateSession('')).toBeNull();
  });

  it('rejects a missing Authorization header', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const request = new Request('https://forge.test');
    await expect(adapter.requireAuth(request)).rejects.toThrow('Unauthorized');
  });

  it('rejects a malformed Authorization header', async () => {
    const adapter = new SignedTokenAuthAdapter({ devMode: true }).init();
    const request = new Request('https://forge.test', {
      headers: { authorization: 'Basic abc123' }
    });
    await expect(adapter.requireAuth(request)).rejects.toThrow('Unauthorized');
  });
});
