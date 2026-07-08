import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { DEMO_CREDENTIALS, SignedTokenAuthAdapter } from './signed-token.adapter.js';

function createAdapter() {
  return new SignedTokenAuthAdapter().init();
}

// Contract tests require synchronous setup, but issuing a token is inherently async (Web Crypto).
// Signed once here via top-level await; valid against every adapter instance the contract test
// creates in beforeEach, since they all derive the same fixed dev-only secret when no env is passed.
const contractToken = await new SignedTokenAuthAdapter()
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

  it('login() succeeds with the published demo credentials', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const result = await adapter.login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe(DEMO_CREDENTIALS.email);
    expect(typeof result?.token).toBe('string');
  });

  it('login() rejects an incorrect password', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const result = await adapter.login(DEMO_CREDENTIALS.email, 'wrong-password');
    expect(result).toBeNull();
  });

  it('login() rejects an unknown email', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const result = await adapter.login('nobody@example.com', DEMO_CREDENTIALS.password);
    expect(result).toBeNull();
  });

  it('a token issued via login() authenticates a subsequent request', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const login = await adapter.login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${login?.token}` }
    });
    const user = await adapter.requireAuth(request);
    expect(user.email).toBe(DEMO_CREDENTIALS.email);
  });

  it('rejects an expired token', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const token = await adapter.issueToken({ id: 'user-1' });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000); // 25h later, past the 24h TTL

    const session = await adapter.validateSession(token);
    expect(session).toBeNull();
  });

  it('rejects a token with a tampered signature', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    const token = await adapter.issueToken({ id: 'user-1' });
    const [payloadPart, signaturePart] = token.split('.');
    const flippedChar = signaturePart?.[0] === 'a' ? 'b' : 'a';
    const tampered = `${payloadPart}.${flippedChar}${signaturePart?.slice(1)}`;

    const session = await adapter.validateSession(tampered);
    expect(session).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const adapter = new SignedTokenAuthAdapter().init();
    expect(await adapter.validateSession('not-a-valid-token')).toBeNull();
    expect(await adapter.validateSession('')).toBeNull();
  });
});
