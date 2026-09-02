import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { extractToken as extractSharedToken } from './token-signer.js';

export interface ExternalAuthConfig {
  /** URL of the auth microservice used to validate tokens */
  validateUrl: string;
  /** Optional API key to authenticate with the microservice */
  apiKey?: string;
}

/**
 * Auth adapter that delegates session validation to an external microservice.
 *
 * Platform-agnostic — uses the native fetch() API, works in:
 * - Cloudflare Workers / Pages Functions
 * - Vercel Edge Functions
 * - Deno Deploy
 * - Node.js 18+ (with global fetch)
 */
export class ExternalAuthAdapter implements AuthAdapter {
  readonly name = 'external';
  private config?: ExternalAuthConfig;

  init(env?: unknown): this {
    const envRecord = env as Record<string, string> | undefined;
    const validateUrl = envRecord?.AUTH_VALIDATE_URL;

    if (validateUrl) {
      this.config = {
        validateUrl,
        ...(envRecord?.AUTH_API_KEY ? { apiKey: envRecord.AUTH_API_KEY } : {})
      };
    }

    return this;
  }

  /** Shared with `UsersCollectionAuthAdapter`/`SignedTokenAuthAdapter` — case-insensitive `Bearer`,
   *  trims, and falls back to the Forge session cookie (spec 053's cookie-fallback hardening). */
  extractToken(request: Request): string | null {
    return extractSharedToken(request);
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    if (!this.config) {
      throw new Error(
        'ExternalAuthAdapter not configured. Set AUTH_VALIDATE_URL in environment bindings.'
      );
    }

    if (!token) return null;

    let response: Response;
    try {
      response = await fetch(this.config.validateUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {})
        },
        body: JSON.stringify({ token })
      });
    } catch (err) {
      // A network failure reaching the validation service is an infrastructure fault, not proof the
      // token is invalid — surfacing it as `null` (→ a misleading 401) would hide a real outage behind
      // "unauthenticated", exactly the pattern spec 049 fixed for `CompositeAuthAdapter`/`handlers.ts`.
      throw new Error(
        `ExternalAuthAdapter: failed to reach validation service: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // A `5xx` means the service itself is failing, not that it examined the token and rejected it —
    // same "don't mask an outage as unauthenticated" rule as the network-failure case above.
    if (response.status >= 500) {
      throw new Error(`ExternalAuthAdapter: validation service returned ${response.status}`);
    }

    // A `4xx` is the service explicitly rejecting the token — a real, expected "invalid session".
    if (!response.ok) return null;

    const data = (await response.json()) as {
      user: AuthUser;
      expiresAt?: string;
    };

    return {
      user: data.user,
      ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {})
    };
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    const session = await this.validateSession(token ?? '');

    if (!session) {
      throw new ForgeAuthError('Unauthorized', 'unauthorized');
    }

    return session.user;
  }
}
