import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { ExternalAuthAdapter } from './external.adapter.js';

const VALID_TOKEN = 'opaque-external-token';

function stubFetchOnce(response: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response)
  );
}

describe('ExternalAuthAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extractToken reads the Bearer header (shared with the signed-token adapters)', () => {
    const adapter = new ExternalAuthAdapter().init({
      AUTH_VALIDATE_URL: 'https://auth.test/validate'
    });
    const request = new Request('https://forge.test', {
      headers: { authorization: `Bearer ${VALID_TOKEN}` }
    });
    expect(adapter.extractToken(request)).toBe(VALID_TOKEN);
  });

  it('extractToken falls back to the session cookie when no Authorization header is present', () => {
    const adapter = new ExternalAuthAdapter().init({
      AUTH_VALIDATE_URL: 'https://auth.test/validate'
    });
    const request = new Request('https://forge.test', {
      headers: { cookie: `forge_session=${VALID_TOKEN}` }
    });
    expect(adapter.extractToken(request)).toBe(VALID_TOKEN);
  });

  describe('validateSession', () => {
    let adapter: ExternalAuthAdapter;

    beforeEach(() => {
      adapter = new ExternalAuthAdapter().init({ AUTH_VALIDATE_URL: 'https://auth.test/validate' });
    });

    it('returns a session for a 2xx response', async () => {
      stubFetchOnce(
        new Response(JSON.stringify({ user: { id: 'ext-1', email: 'ext@example.com' } }), {
          status: 200
        })
      );
      const session = await adapter.validateSession(VALID_TOKEN);
      expect(session?.user.id).toBe('ext-1');
    });

    it('returns null for an explicit 4xx rejection', async () => {
      stubFetchOnce(new Response(null, { status: 401 }));
      const session = await adapter.validateSession(VALID_TOKEN);
      expect(session).toBeNull();
    });

    it('throws (does not swallow to null) on a 5xx from the validation service', async () => {
      stubFetchOnce(new Response(null, { status: 503 }));
      await expect(adapter.validateSession(VALID_TOKEN)).rejects.toThrow(/503/);
    });

    it('throws (does not swallow to null) when the validation service is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down');
        })
      );
      await expect(adapter.validateSession(VALID_TOKEN)).rejects.toThrow(/failed to reach/);
    });
  });
});

runAuthAdapterContractTests(
  () => {
    stubFetchOnce(new Response(JSON.stringify({ user: { id: 'contract-user' } }), { status: 200 }));
    return new ExternalAuthAdapter().init({ AUTH_VALIDATE_URL: 'https://auth.test/validate' });
  },
  () => new Request('https://forge.test', { headers: { authorization: `Bearer ${VALID_TOKEN}` } })
);
