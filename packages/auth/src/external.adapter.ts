import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

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

  extractToken(request: Request): string | null {
    return request.headers.get('authorization')?.replace('Bearer ', '') ?? null;
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    if (!this.config) {
      throw new Error(
        'ExternalAuthAdapter not configured. Set AUTH_VALIDATE_URL in environment bindings.'
      );
    }

    if (!token) return null;

    try {
      const response = await fetch(this.config.validateUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {})
        },
        body: JSON.stringify({ token })
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        user: AuthUser;
        expiresAt?: string;
      };

      return {
        user: data.user,
        ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {})
      };
    } catch {
      return null;
    }
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
