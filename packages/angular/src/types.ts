/**
 * Shared types for the ForgeCMS Angular client, plus the typed errors the service throws.
 *
 * Kept apart from `api.service.ts` so `resources.ts` can depend on both without an import cycle
 * (`import/no-cycle` is an error in this repo).
 */
import { InjectionToken } from '@angular/core';
import type { Provider } from '@angular/core';

/** The `meta` block of a list response (spec 018 added everything past `count`). */
export interface ListMeta {
  collection: string;
  /** Length of this page. Predates pagination metadata; kept for backwards compatibility. */
  count: number;
  totalDocs: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit?: number;
  offset?: number;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: ListMeta;
}

/** A page of documents plus everything a paginator needs. */
export interface PaginatedDocuments<T> {
  docs: T[];
  meta: ListMeta;
}

export interface ApiItemResponse<T> {
  data: T;
}

/** One selectable shape of a `blocks` field, as sent to the client. */
export interface BlockMeta {
  slug: string;
  label: string;
  fields: FieldMeta[];
}

export interface FieldMeta {
  name: string;
  kind: string;
  label: string;
  required: boolean;
  options?: string[];
  relation?: {
    collection: string;
    many: boolean;
  };
  /** Nested fields of a `group` or `array` field (spec 022). */
  fields?: FieldMeta[];
  /** Selectable shapes of a `blocks` field (spec 022). */
  blocks?: BlockMeta[];
  minRows?: number;
  maxRows?: number;
  /** `true` when the field stores per-locale values (`{ en: "Hello", es: "Hola" }`). */
  localized?: boolean;
}

export interface CollectionMeta {
  slug: string;
  name: string;
  description: string;
  fieldDefinitions: FieldMeta[];
  /** The collection has draft/published status, so the admin shows and can toggle it. */
  drafts?: boolean;
  /** The collection accepts multipart uploads. */
  upload?: boolean;
  /** Supported locales when the collection has localized fields. */
  locales?: string[];
  /** Field name whose value the admin should use as a document's display title (spec 052). */
  useAsTitle?: string;
  /** Field names the admin should show as list columns (spec 052). Presentational hint only. */
  defaultColumns?: string[];
}

export interface GlobalMeta {
  slug: string;
  name: string;
  description: string;
  fieldDefinitions: FieldMeta[];
  /** The global has draft/published status. */
  drafts?: boolean;
}

export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

/** How a {@link ForgeApiError} failed — see spec 075's error table. */
export type ForgeApiErrorKind =
  /** The server answered with a non-2xx status; `status` is set. */
  | 'http'
  /** No response at all: offline, DNS, refused connection, CORS rejection. `status` is `undefined`. */
  | 'network'
  /** The caller's `AbortSignal` fired. `status` is `undefined`. */
  | 'aborted'
  /** A 2xx whose body is not JSON or lacks the `{ data }` envelope. `status` is set. */
  | 'invalid-response';

export interface ForgeApiErrorInit {
  kind: ForgeApiErrorKind;
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  cause?: unknown;
}

/**
 * The one error every `CmsApiService` failure is (spec 075). Keeps the HTTP status, the server's Forge
 * `code` and `details`, and says whether a response arrived at all. Response bodies that are not the
 * Forge envelope (an HTML proxy page) are never copied into it.
 *
 * `ApiValidationError`, `ApiAuthError` and `ApiAuthActionError` are subclasses, so existing
 * `instanceof` checks keep working.
 */
export class ForgeApiError extends Error {
  readonly kind: ForgeApiErrorKind;
  readonly code: string;
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(init: ForgeApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ForgeApiError';
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
  }
}

/** `true` for any {@link ForgeApiError} (optionally of one `kind`). */
export function isForgeApiError(error: unknown, kind?: ForgeApiErrorKind): error is ForgeApiError {
  return error instanceof ForgeApiError && (kind === undefined || error.kind === kind);
}

/**
 * A `400`-class response carrying per-field errors (`error.details` is an `ApiFieldError[]`). `details`
 * is directly usable by forms.
 */
export class ApiValidationError extends ForgeApiError {
  declare readonly details: ApiFieldError[];

  constructor(
    message: string,
    details: ApiFieldError[],
    init: { status?: number; code?: string } = {}
  ) {
    super({
      kind: 'http',
      status: init.status ?? 400,
      code: init.code ?? 'VALIDATION_ERROR',
      message,
      details
    });
    this.name = 'ApiValidationError';
  }
}

/**
 * A `401` on a content or user-management request: the caller is not (or no longer) authenticated.
 * Only a 401 — never a 403 — becomes this error or notifies `onUnauthorized` listeners.
 */
export class ApiAuthError extends ForgeApiError {
  constructor(message = 'Unauthorized', init: { code?: string; details?: unknown } = {}) {
    super({
      kind: 'http',
      status: 401,
      code: init.code ?? 'UNAUTHORIZED',
      message,
      ...(init.details !== undefined && { details: init.details })
    });
    this.name = 'ApiAuthError';
  }
}

/** The `{ error: { code, message } }` envelope every Forge HTTP error response carries. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * An HTTP failure of `login`/`signup`/`logout`. `.message` is the server's own curated text from spec
 * 053's `authFailureResponse` table (e.g. `'Invalid email or password'`) — safe to show to a user.
 * A network failure of those calls is a plain {@link ForgeApiError} with `kind: 'network'`.
 */
export class ApiAuthActionError extends ForgeApiError {
  declare readonly status: number;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super({ kind: 'http', code, message, status, ...(details !== undefined && { details }) });
    this.name = 'ApiAuthActionError';
  }
}

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export const USER_ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

export function userRole(user: AuthUser | null | undefined): UserRole {
  const role = user?.role;
  if (role === 'admin' || role === 'editor' || role === 'viewer') return role;
  return 'viewer';
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return userRole(user) === 'admin';
}

export function canWriteContent(user: AuthUser | null | undefined): boolean {
  const role = userRole(user);
  return role === 'admin' || role === 'editor';
}

export function canManageUsers(user: AuthUser | null | undefined): boolean {
  return isAdmin(user);
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: UserRole;
}

/** One request as {@link ForgeTransport} receives it — already joined, encoded and credentialed. */
export interface ForgeTransportRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  /** `'include'` only for a credential target (see {@link ForgeCmsConfig.trustedOrigins}), else `'omit'`. */
  credentials: 'include' | 'omit';
  body?: BodyInit;
  signal?: AbortSignal;
}

/**
 * The injectable request boundary (spec 075). The default is native `fetch`. Replace it to test
 * deterministically or, later, to route requests during SSR. It must not retry: a failed write has an
 * unknown outcome on the server.
 */
export type ForgeTransport = (request: ForgeTransportRequest) => Promise<Response>;

/** Per-call options every `CmsApiService` method accepts as its last argument. */
export interface ForgeRequestOptions {
  /** Aborting rejects the call with a `ForgeApiError` of `kind: 'aborted'`. */
  signal?: AbortSignal;
}

export interface ForgeCmsConfig {
  /**
   * Content API base: collections, documents, globals, preview. Defaults to `'/api/v1'`. Relative
   * values resolve against the page's origin; absolute ones (`https://cms.example.com/api/v1`) are
   * used as given. A trailing slash is ignored.
   */
  baseUrl?: string;
  /**
   * Base for `/login`, `/signup`, `/logout`, `/me`, and `/users*` (spec 058 §9). Defaults to
   * `'/api/auth'`. Same relative/absolute rules as {@link baseUrl}.
   */
  authBaseUrl?: string;
  /** Sent as `Authorization: Bearer …`, only to credential targets (see {@link trustedOrigins}). */
  authToken?: string | (() => string | null);
  /**
   * Browser cookies for credential targets: `'include'` (default — the cookie session of spec 053)
   * or `'omit'` (Bearer-only apps). Requests to any other origin never carry cookies.
   */
  credentials?: 'include' | 'omit';
  /**
   * Extra origins (e.g. `'https://cms.example.com'`) that may receive cookies and the Bearer token.
   * Relative URLs and the page's own origin always may; any other absolute origin receives neither
   * unless listed here. The server must also allow it (CORS with credentials).
   */
  trustedOrigins?: readonly string[];
  /** Replaces the default `fetch` transport. */
  transport?: ForgeTransport;
}

export const FORGE_CMS_CONFIG = new InjectionToken<ForgeCmsConfig>('FORGE_CMS_CONFIG');

/** `provideForgeCms()` with no argument keeps every default (same-origin `/api/v1` and `/api/auth`). */
export function provideForgeCms(config: ForgeCmsConfig = {}): Provider[] {
  return [{ provide: FORGE_CMS_CONFIG, useValue: config }];
}
