/**
 * The request boundary every `CmsApiService` method goes through (spec 075, roadmap C01): URL
 * joining, identifier encoding, the credential policy, and the one structured error every failure
 * becomes. Deliberately small — no interceptors, no retries, no caching.
 *
 * Depends only on `types.ts`, so the service and its tests can import it without a cycle.
 */
import {
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  ForgeApiError,
  type ApiFieldError,
  type ForgeCmsConfig,
  type ForgeTransport,
  type ForgeTransportRequest
} from './types.js';
import type { ForgeServerContext } from './server-token.js';

export const DEFAULT_CONTENT_BASE_URL = '/api/v1';
export const DEFAULT_AUTH_BASE_URL = '/api/auth';

/** The default {@link ForgeTransport}: native `fetch`, looked up per call so test stubs and SSR polyfills apply. */
export const fetchTransport: ForgeTransport = (request) =>
  globalThis.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    ...(request.body !== undefined && { body: request.body }),
    ...(request.signal !== undefined && { signal: request.signal })
  });

/**
 * A server platform without `provideForgeCmsServer` (spec 078): no `credentials` field (no cookie jar)
 * and never following a redirect with a configured token.
 */
const noRedirectFetchTransport: ForgeTransport = (request) =>
  globalThis.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
    ...(request.body !== undefined && { body: request.body }),
    ...(request.signal !== undefined && { signal: request.signal })
  });

/**
 * One path segment, percent-encoded: `/`, `?`, `#`, `%`, `+`, spaces and non-ASCII characters can
 * never change which route is addressed. Empty, `.` and `..` segments are refused rather than encoded:
 * the WHATWG URL parser treats `%2E%2E` as `..` too, so no encoding makes them safe.
 */
export function encodePathSegment(value: string, label = 'identifier'): string {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') {
    throw new TypeError(`ForgeCMS: invalid ${label} ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}

/**
 * Joins a configured base with already-encoded segments and a query string (`''` or `'?…'`). Only
 * trailing slashes of the base are trimmed, so `https://` and any path inside the base are untouched:
 * `'/api/v1/'` + `['posts']` → `'/api/v1/posts'`.
 */
export function joinUrl(base: string, segments: readonly string[], query = ''): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/${segments.join('/')}${query}`;
}

/** `true` for `scheme:` and protocol-relative (`//host`) URLs. */
export function isAbsolute(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//');
}

function pageOrigin(): string | undefined {
  const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin;
  return typeof origin === 'string' && origin !== 'null' ? origin : undefined;
}

/**
 * Whether a request URL may receive the browser's cookies and the configured Bearer token. A relative
 * URL targets the page's own origin and always may; an absolute URL may only when its origin is the
 * page's origin or is listed in `trustedOrigins`. Outside a browser (no `location`) an absolute URL is
 * trusted only through `trustedOrigins`.
 */
export function isCredentialTarget(
  url: string,
  trustedOrigins: readonly string[] = [],
  usePageOrigin = true
): boolean {
  if (!isAbsolute(url)) return true;
  const page = usePageOrigin ? pageOrigin() : undefined;
  let origin: string;
  try {
    origin = new URL(url, page).origin;
  } catch {
    return false;
  }
  if (page !== undefined && origin === page) return true;
  return trustedOrigins.some((trusted) => {
    try {
      return new URL(trusted).origin === origin;
    } catch {
      return false;
    }
  });
}

/** Combines the caller's signal with the owner's lifetime signal (either may be absent). */
function combineSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined
): AbortSignal | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

/**
 * Where the requester runs (spec 078). The browser default is `{ server: null, onServer: false }` and
 * changes nothing.
 */
export interface RequesterEnvironment {
  /** The render's resolved server context (`provideForgeCmsServer`), or `null`. */
  server: ForgeServerContext | null;
  /** Running on a server platform (`PLATFORM_ID === 'server'`). */
  onServer: boolean;
  /** Registers a pending task for the duration of one request; returns its release. */
  track?: () => () => void;
  /** Aborted when the owning application is destroyed. */
  lifetime?: AbortSignal;
}

export interface SendOptions {
  method: ForgeTransportRequest['method'];
  url: string;
  /** Serialized as the body, with `content-type: application/json`. */
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal | undefined;
  /** Human fallback when the server supplies no message, e.g. `'Failed to fetch document'`. */
  failure: string;
  /**
   * Login/signup/logout: an HTTP failure is always `ApiAuthActionError`, a 401 never counts as session
   * expiry, and no Bearer token is attached.
   */
  authAction?: boolean;
  /** Statuses returned instead of thrown (`/me` → 401, `getGlobal` → 404). */
  passStatuses?: readonly number[];
}

/** Returned by {@link ForgeRequester.send} for a status listed in `passStatuses`. */
export class PassedStatus {
  constructor(readonly status: number) {}
}

/** Sends one request and decodes its JSON body, turning every failure into a {@link ForgeApiError}. */
export class ForgeRequester {
  constructor(
    private readonly config: ForgeCmsConfig | null,
    private readonly onUnauthorized: () => void,
    private readonly env: RequesterEnvironment = { server: null, onServer: false }
  ) {}

  get contentBase(): string {
    return this.config?.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  }

  get authBase(): string {
    return this.config?.authBaseUrl ?? DEFAULT_AUTH_BASE_URL;
  }

  /** The configured Bearer token (also read reactively by the credential boundary, spec 077). */
  token(): string | null {
    const token = this.config?.authToken;
    if (typeof token === 'function') return token();
    return token ?? null;
  }

  private buildRequest(options: SendOptions): ForgeTransportRequest {
    const server = this.env.server;
    if (server !== null) {
      // SSR (spec 078): the render's own policy resolves the URL and forwards its visitor's identity.
      return server.request(
        {
          url: options.url,
          method: options.method,
          ...(options.json !== undefined && { json: options.json }),
          ...(options.body !== undefined && { body: options.body }),
          signal: options.signal,
          authAction: options.authAction === true,
          token: () => this.token()
        },
        this.config
      );
    }
    // A server without `provideForgeCmsServer` (absolute URLs only — relative ones were refused) never
    // consults `location`: only `trustedOrigins` may receive the configured token (spec 078).
    const trusted = isCredentialTarget(
      options.url,
      this.config?.trustedOrigins,
      !this.env.onServer
    );
    const headers: Record<string, string> = {};
    if (options.json !== undefined) headers['content-type'] = 'application/json';
    // Login/signup/logout identify the caller by their body or cookie, never a configured token.
    const token = trusted && !options.authAction ? this.token() : null;
    if (token) headers['authorization'] = `Bearer ${token}`;

    const cookies = trusted && (this.config?.credentials ?? 'include') === 'include';
    const body = options.json !== undefined ? JSON.stringify(options.json) : options.body;
    return {
      url: options.url,
      method: options.method,
      headers,
      credentials: cookies && !this.env.onServer ? 'include' : 'omit',
      ...(body !== undefined && { body }),
      ...(options.signal !== undefined && { signal: options.signal })
    };
  }

  /** Sends and returns the parsed JSON body (`undefined` for a `204`). Never retries. */
  async send(options: SendOptions): Promise<unknown> {
    const signal = combineSignals(options.signal, this.env.lifetime);
    const sending = { ...options, signal };
    // A server render without `provideForgeCmsServer` has no origin for a relative URL: fail before any
    // request rather than letting `fetch` guess (spec 078). A custom transport may route it in-process.
    if (
      this.env.onServer &&
      this.env.server === null &&
      this.config?.transport === undefined &&
      !isAbsolute(options.url)
    ) {
      throw new ForgeApiError({
        kind: 'network',
        code: 'SERVER_ORIGIN_REQUIRED',
        message: `${options.failure}: no server origin is configured for server rendering (provideForgeCmsServer)`
      });
    }
    // The owning server application is gone: nothing it starts may reach the network.
    if (this.env.lifetime?.aborted) throw abortedError(options, this.env.lifetime.reason);
    const release = this.env.track?.();
    try {
      return await this.dispatch(sending);
    } finally {
      release?.();
    }
  }

  private async dispatch(options: SendOptions): Promise<unknown> {
    const request = this.buildRequest(options);
    const transport =
      this.config?.transport ??
      this.env.server?.transport ??
      (this.env.onServer ? noRedirectFetchTransport : fetchTransport);

    let response: Response;
    try {
      response = await transport(request);
    } catch (error) {
      throw transportFailure(error, options, request.signal);
    }

    if (options.passStatuses?.includes(response.status)) return new PassedStatus(response.status);
    if (!response.ok) throw await this.httpFailure(response, options);
    if (response.status === 204) return undefined;

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      if (isAbort(error, request.signal)) throw abortedError(options, error);
      throw new ForgeApiError({
        kind: 'invalid-response',
        code: 'INVALID_RESPONSE',
        status: response.status,
        message: `${options.failure}: the server returned a response that is not valid JSON`,
        cause: error
      });
    }
  }

  private async httpFailure(response: Response, options: SendOptions): Promise<ForgeApiError> {
    const parsed = await readErrorBody(response);
    const status = response.status;

    if (options.authAction) {
      return new ApiAuthActionError(
        parsed.code ?? 'UNKNOWN',
        parsed.message ?? options.failure,
        status,
        parsed.details
      );
    }
    if (status === 401) {
      this.onUnauthorized();
      return new ApiAuthError(parsed.message ?? 'Unauthorized', {
        ...(parsed.code !== undefined && { code: parsed.code }),
        ...(parsed.details !== undefined && { details: parsed.details })
      });
    }
    const message = parsed.message ?? `${options.failure}: ${status}`;
    if (Array.isArray(parsed.details)) {
      return new ApiValidationError(message, parsed.details as ApiFieldError[], {
        status,
        ...(parsed.code !== undefined && { code: parsed.code })
      });
    }
    return new ForgeApiError({
      kind: 'http',
      status,
      code: parsed.code ?? 'HTTP_ERROR',
      message,
      ...(parsed.details !== undefined && { details: parsed.details })
    });
  }
}

interface ParsedErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * Reads every error shape Forge routes produce. A non-JSON body (a proxy page, HTML) yields nothing:
 * its text never becomes the error message, since it may carry infrastructure details.
 */
async function readErrorBody(response: Response): Promise<ParsedErrorBody> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  if (typeof body !== 'object' || body === null) return {};
  const record = body as {
    error?: unknown;
    details?: unknown;
    statusMessage?: unknown;
    message?: unknown;
  };
  // Current envelope `{ error: { code, message, details? } }` — details nest inside `error`.
  if (typeof record.error === 'object' && record.error !== null) {
    const error = record.error as { code?: unknown; message?: unknown; details?: unknown };
    const details = error.details ?? record.details;
    return {
      ...(typeof error.code === 'string' && { code: error.code }),
      ...(typeof error.message === 'string' && { message: error.message }),
      ...(details !== undefined && { details })
    };
  }
  // Older flat `{ error: string, details }`, and h3's `createError` `{ statusMessage, message }`.
  const message =
    typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : typeof record.statusMessage === 'string'
          ? record.statusMessage
          : undefined;
  return {
    ...(message !== undefined && { message }),
    ...(record.details !== undefined && { details: record.details })
  };
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

function abortedError(options: SendOptions, cause: unknown): ForgeApiError {
  return new ForgeApiError({
    kind: 'aborted',
    code: 'ABORTED',
    message: `${options.failure}: the request was aborted`,
    cause
  });
}

function transportFailure(
  error: unknown,
  options: SendOptions,
  signal: AbortSignal | undefined
): ForgeApiError {
  if (error instanceof ForgeApiError) return error;
  if (isAbort(error, signal)) return abortedError(options, error);
  return new ForgeApiError({
    kind: 'network',
    code: 'NETWORK_ERROR',
    message: `${options.failure}: the server could not be reached`,
    cause: error
  });
}

/** Narrows a decoded body to its `{ data }` envelope, or throws an `invalid-response` error. */
export function dataOf<T>(body: unknown, failure: string): T {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return (body as { data: T }).data;
  }
  throw new ForgeApiError({
    kind: 'invalid-response',
    code: 'INVALID_RESPONSE',
    message: `${failure}: the response is missing its data envelope`
  });
}
