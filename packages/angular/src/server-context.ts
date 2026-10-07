import { PLATFORM_ID, REQUEST, inject } from '@angular/core';
import type { Provider } from '@angular/core';
import {
  FORGE_SERVER_CONTEXT,
  type ForgeServerContext,
  type ServerRequestInput
} from './server-token.js';
import { isAbsolute } from './transport.js';
import type { ForgeCmsConfig, ForgeTransport, ForgeTransportRequest } from './types.js';

/**
 * Server rendering configuration for `provideForgeCmsServer()` (spec 078, roadmap S01). Exported from
 * `@forge-cms/angular/server` only.
 */
export interface ForgeServerConfig {
  /**
   * The absolute `http:`/`https:` origin Forge is reachable at from this server, e.g.
   * `'http://127.0.0.1:3000'` or `'https://site.example'`. Relative `baseUrl`/`authBaseUrl` resolve
   * against it during SSR, and it is the only origin that receives forwarded cookies (a forwarded
   * `Authorization` header may also go to `ForgeCmsConfig.trustedOrigins`). Never derived from the incoming `Host`/`Forwarded` headers.
   */
  origin: string;
  /**
   * Names of the incoming request's cookies forwarded (as a `cookie` header) to credential targets.
   * Default `[]`: anonymous SSR. `['forge_session']` renders as the visiting cookie-session user.
   */
  forwardCookies?: readonly string[];
  /**
   * Forward the incoming `Authorization` header to the origin and `trustedOrigins`. Default `false`.
   * A client configured with `credentials: 'omit'` (e.g. an anonymous public-route client) never
   * receives forwarded cookies.
   */
  forwardAuthorization?: boolean;
}

// RFC 6265 `cookie-name` = RFC 7230 token.
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** The canonical origin of `value`, or a `TypeError` — a misconfigured server fails, never guesses. */
export function validateServerOrigin(value: unknown): string {
  const invalid = () =>
    new TypeError(
      `ForgeCMS: invalid server origin ${JSON.stringify(value)} — expected an absolute http(s) origin such as 'https://site.example'`
    );
  if (typeof value !== 'string') throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.origin !== trimmed
  ) {
    throw invalid();
  }
  return url.origin;
}

/**
 * Reduces a `cookie` header to the listed names: exact name match, first occurrence, original
 * `name=value` text. Returns `undefined` when none is present.
 */
export function selectCookies(header: string | null, names: readonly string[]): string | undefined {
  if (header === null || names.length === 0) return undefined;
  const picked = new Map<string, string>();
  for (const part of header.split(';')) {
    const pair = part.trim();
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (names.includes(name) && !picked.has(name)) picked.set(name, pair);
  }
  return picked.size > 0 ? [...picked.values()].join('; ') : undefined;
}

/**
 * The server-side default transport: no `credentials` field (a server has no cookie jar, and not every
 * server runtime implements it) and `redirect: 'manual'`, so a request carrying a forwarded cookie or
 * `Authorization` header is never replayed to wherever a 3xx points.
 */
export const serverFetchTransport: ForgeTransport = (request) =>
  globalThis.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
    ...(request.body !== undefined && { body: request.body }),
    ...(request.signal !== undefined && { signal: request.signal })
  });

/**
 * Server credential target: the URL's origin is the configured server origin or listed in
 * `trustedOrigins`. `globalThis.location` is never consulted; anything unparsable is not a target.
 */
export function isServerCredentialTarget(
  url: string,
  serverOrigin: string,
  trustedOrigins: readonly string[] = []
): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  if (origin === serverOrigin) return true;
  return trustedOrigins.some((trusted) => {
    try {
      return new URL(trusted).origin === origin;
    } catch {
      return false;
    }
  });
}

/** Resolves one render's policy from its own `REQUEST` (or `null`: anonymous). */
export function resolveServerContext(
  config: ForgeServerConfig,
  request: Request | null
): ForgeServerContext {
  const origin = validateServerOrigin(config.origin);
  const names = config.forwardCookies ?? [];
  for (const name of names) {
    if (typeof name !== 'string' || !COOKIE_NAME.test(name)) {
      throw new TypeError(
        `ForgeCMS: invalid cookie name ${JSON.stringify(name)} in forwardCookies`
      );
    }
  }
  const forwardAuthorization = config.forwardAuthorization === true;
  const cookie = selectCookies(request?.headers.get('cookie') ?? null, names);
  const incomingAuthorization = forwardAuthorization
    ? request?.headers.get('authorization')
    : undefined;
  const authorization = incomingAuthorization ? incomingAuthorization : undefined;

  return Object.freeze({
    origin,
    forwardsAuthorization: forwardAuthorization,
    transport: serverFetchTransport,

    assertCompatible(app: ForgeCmsConfig | null): void {
      if ((names.length > 0 || forwardAuthorization) && app?.authToken !== undefined) {
        throw new TypeError(
          'ForgeCMS: authToken cannot be combined with forwardCookies/forwardAuthorization — an app credential and a visitor identity are never sent together'
        );
      }
    },

    request(input: ServerRequestInput, app: ForgeCmsConfig | null): ForgeTransportRequest {
      const url = isAbsolute(input.url) ? input.url : new URL(input.url, `${origin}/`).href;
      const trusted = isServerCredentialTarget(url, origin, app?.trustedOrigins);
      const headers: Record<string, string> = {};
      if (input.json !== undefined) headers['content-type'] = 'application/json';
      if (trusted && !input.authAction) {
        const token = input.token();
        if (token) headers['authorization'] = `Bearer ${token}`;
        else if (authorization !== undefined) headers['authorization'] = authorization;
      }
      // A cookie belongs to this site: only the configured origin receives it — never a trusted
      // third-party origin, exactly as a browser would never send it there.
      const sameOrigin = isServerCredentialTarget(url, origin);
      if (sameOrigin && cookie !== undefined && app?.credentials !== 'omit') {
        headers['cookie'] = cookie;
      }
      const body = input.json !== undefined ? JSON.stringify(input.json) : input.body;
      return {
        url,
        method: input.method,
        headers,
        credentials: 'omit',
        ...(body !== undefined && { body }),
        ...(input.signal !== undefined && { signal: input.signal })
      };
    }
  });
}

/**
 * Server-only providers for `CmsApiService` during SSR (spec 078): the origin relative Forge URLs resolve
 * against, and which of the **current** incoming request's credentials may be forwarded. Read from
 * Angular's `REQUEST` token in the render's own injector — nothing is stored outside DI. Ignored on a
 * browser platform, so a shared config cannot change browser behavior.
 */
export function provideForgeCmsServer(config: ForgeServerConfig): Provider[] {
  return [
    {
      provide: FORGE_SERVER_CONTEXT,
      useFactory: (): ForgeServerContext | null => {
        if (inject(PLATFORM_ID, { optional: true }) !== 'server') return null;
        return resolveServerContext(config, inject(REQUEST, { optional: true }) ?? null);
      }
    }
  ];
}
