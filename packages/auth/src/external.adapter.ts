import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';

export interface ExternalAuthConfig {
  /** URL del microservicio de auth para validar tokens */
  validateUrl: string;
  /** API key opcional para autenticar con el microservicio */
  apiKey?: string;
}

/**
 * Auth adapter que delega la validación de sesiones a un microservicio externo.
 *
 * Agnóstico de plataforma — usa la API fetch() nativa, funciona en:
 * - Cloudflare Workers / Pages Functions
 * - Vercel Edge Functions
 * - Deno Deploy
 * - Node.js 18+ (con fetch global)
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
