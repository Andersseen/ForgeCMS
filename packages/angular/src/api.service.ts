import { Injectable, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { buildQueryString } from './query.js';
import type { QueryOptions } from './query.js';
import type {
  ForgeCollectionSlug,
  ForgeCreateInput,
  ForgeDocument,
  ForgeDraftsCollectionSlug,
  ForgeGlobalDocument,
  ForgeGlobalInput,
  ForgeGlobalSlug,
  ForgeGlobalWriteResult,
  ForgeQueryOptions,
  ForgeSchema,
  ForgeUpdateInput,
  ForgeUploadFields,
  ForgeWhere,
  ForgeWriteResult,
  UntypedForgeSchema
} from './schema.js';
import { ForgeRequester, PassedStatus, dataOf, encodePathSegment, joinUrl } from './transport.js';
import type { SendOptions } from './transport.js';
import {
  FORGE_CMS_CONFIG,
  type ApiListResponse,
  type AuthUser,
  type CollectionMeta,
  type CreateUserInput,
  type ForgeRequestOptions,
  type PaginatedDocuments
} from './types.js';

/** Read options of a single document: the `depth` and `locale` that shape the result. */
export interface ForgeDocumentReadOptions<D extends 0 | 1, L extends string | undefined> {
  depth?: D;
  locale?: L;
}

/** Write options: a `locale` makes localized fields take a plain string for that locale. */
export interface ForgeWriteOptions<L extends string | undefined> {
  locale?: L;
}

/**
 * Promise-based client for Forge's HTTP API. Every method sends exactly one request through the
 * configured transport (spec 075) and never retries. Every failure rejects with a `ForgeApiError`
 * (or one of its compatible subclasses) that keeps the HTTP status, Forge `code` and `details`.
 *
 * `S` is the content model's type (spec 076). `inject(CmsApiService)` is the **untyped** client: any
 * slug, `Record<string, unknown>` payloads, `UntypedDocument` results — what a dynamic consumer such as
 * the admin needs. `injectForgeClient<SiteSchema>()` returns the same instance typed by a schema, so
 * slugs, fields, payloads and results are checked against the JSON the server sends. Responses are
 * not validated at runtime: the types are only as true as the shared schema type.
 */
@Injectable({ providedIn: 'root' })
export class CmsApiService<S extends ForgeSchema = UntypedForgeSchema> {
  private readonly config = inject(FORGE_CMS_CONFIG, { optional: true });

  /** Bumped once per observed `401` — a signal for any UI that wants to react to it generically. */
  private readonly unauthorizedCount = signal(0);
  readonly unauthorized: Signal<number> = this.unauthorizedCount.asReadonly();

  /**
   * Plain callback registry `ForgeAuthSession` uses to detect a session going stale mid-app (a 401 on
   * some unrelated request) without polling `/me` in a loop — see `auth-session.ts`. A plain callback
   * rather than an `effect()` on {@link unauthorized}: `effect()` needs the full Angular
   * change-detection scheduler wired up, which this package's lightweight `Injector.create`-based tests
   * don't set up, and a synchronous callback is simpler to reason about here regardless.
   */
  private readonly unauthorizedListeners = new Set<() => void>();

  private readonly requester = new ForgeRequester(this.config, () => {
    this.unauthorizedCount.update((count) => count + 1);
    for (const listener of this.unauthorizedListeners) listener();
  });

  /** Registers a listener called synchronously on every observed `401`. Returns an unsubscribe function. */
  onUnauthorized(listener: () => void): () => void {
    this.unauthorizedListeners.add(listener);
    return () => this.unauthorizedListeners.delete(listener);
  }

  private content(segments: readonly string[], query = ''): string {
    return joinUrl(this.requester.contentBase, segments, query);
  }

  private auth(segments: readonly string[]): string {
    return joinUrl(this.requester.authBase, segments);
  }

  private async data<T>(options: SendOptions): Promise<T> {
    return dataOf<T>(await this.requester.send(options), options.failure);
  }

  private collection(slug: string): string {
    return encodePathSegment(slug, 'collection slug');
  }

  /**
   * `GET {authBaseUrl}/me`. Resolves `null` only for a `401` (nobody is signed in); a `403`, `5xx`,
   * network failure or malformed response rejects with a `ForgeApiError` — an outage is not "signed out".
   */
  async getCurrentUser(request?: ForgeRequestOptions): Promise<AuthUser | null> {
    const failure = 'Failed to load the current session';
    const body = await this.requester.send({
      method: 'GET',
      url: this.auth(['me']),
      failure,
      passStatuses: [401],
      signal: request?.signal
    });
    if (body instanceof PassedStatus) return null;
    return dataOf<AuthUser>(body, failure);
  }

  async getCollections(request?: ForgeRequestOptions): Promise<CollectionMeta[]> {
    return this.data<CollectionMeta[]>({
      method: 'GET',
      url: this.content(['collections']),
      failure: 'Failed to fetch collections',
      signal: request?.signal
    });
  }

  /**
   * Lists documents. Everything the API supports — filters, sorting, pagination, `depth`, draft
   * visibility, `locale` — goes through the query options.
   */
  async getDocuments<
    TSlug extends ForgeCollectionSlug<S>,
    D extends 0 | 1 = 0,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    options?: ForgeQueryOptions<S, TSlug, D, L>,
    request?: ForgeRequestOptions
  ): Promise<ForgeDocument<S, TSlug, D, L>[]> {
    const { docs } = await this.listDocuments(collection, options, request);
    return docs;
  }

  /** Like {@link getDocuments}, but keeps the pagination metadata a paginator needs. */
  async listDocuments<
    TSlug extends ForgeCollectionSlug<S>,
    D extends 0 | 1 = 0,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    options?: ForgeQueryOptions<S, TSlug, D, L>,
    request?: ForgeRequestOptions
  ): Promise<PaginatedDocuments<ForgeDocument<S, TSlug, D, L>>> {
    const failure = `Failed to fetch ${collection}`;
    const body = await this.requester.send({
      method: 'GET',
      url: this.content([this.collection(collection)], query(options)),
      failure,
      signal: request?.signal
    });
    const docs = dataOf<ForgeDocument<S, TSlug, D, L>[]>(body, failure);
    return { docs, meta: (body as ApiListResponse<unknown>).meta };
  }

  /**
   * The first document matching `where`, or `null` if none does (spec 050 §18). No dedicated server
   * route: this calls the existing list endpoint with `limit: 1` and returns its first result — the
   * Local API's `findOne()` is the important primitive; this is client convenience over it.
   */
  async findOne<
    TSlug extends ForgeCollectionSlug<S>,
    D extends 0 | 1 = 0,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    where?: ForgeWhere<S, TSlug>,
    options?: Omit<ForgeQueryOptions<S, TSlug, D, L>, 'where' | 'limit' | 'offset' | 'page'>,
    request?: ForgeRequestOptions
  ): Promise<ForgeDocument<S, TSlug, D, L> | null> {
    const { docs } = await this.listDocuments<TSlug, D, L>(
      collection,
      {
        ...options,
        ...(where !== undefined && { where }),
        limit: 1
      } as ForgeQueryOptions<S, TSlug, D, L>,
      request
    );
    return docs[0] ?? null;
  }

  async getDocument<
    TSlug extends ForgeCollectionSlug<S>,
    D extends 0 | 1 = 0,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    id: string,
    options?: ForgeDocumentReadOptions<D, L>,
    request?: ForgeRequestOptions
  ): Promise<ForgeDocument<S, TSlug, D, L>> {
    return this.data<ForgeDocument<S, TSlug, D, L>>({
      method: 'GET',
      url: this.content(
        [this.collection(collection), encodePathSegment(id, 'document id')],
        query(options)
      ),
      failure: 'Failed to fetch document',
      signal: request?.signal
    });
  }

  /**
   * Uploads a file to an `upload: true` collection (the multipart path from spec 016). `fields` are
   * sent as text parts; the server keeps only declared fields.
   *
   * The content type is deliberately not set: the browser has to add the multipart boundary.
   */
  async uploadFile<TSlug extends ForgeCollectionSlug<S>>(
    collection: TSlug,
    file: File,
    fields: ForgeUploadFields<S, TSlug> = {} as ForgeUploadFields<S, TSlug>,
    request?: ForgeRequestOptions
  ): Promise<ForgeWriteResult<S, TSlug>> {
    const form = new FormData();
    form.set('file', file);
    for (const [name, value] of Object.entries(fields as Record<string, string | undefined>)) {
      if (value !== undefined) form.set(name, value);
    }

    return this.data<ForgeWriteResult<S, TSlug>>({
      method: 'POST',
      url: this.content([this.collection(collection)]),
      body: form,
      failure: 'Failed to upload file',
      signal: request?.signal
    });
  }

  /**
   * `POST` a new document. With `options.locale`, localized fields take a plain string for that locale;
   * without it, a per-locale map. Resolves the created document, or only `{ id }` when the caller may
   * create but not read it (spec 068).
   */
  async createDocument<
    TSlug extends ForgeCollectionSlug<S>,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    data: ForgeCreateInput<S, NoInfer<TSlug>, NoInfer<L>>,
    options?: ForgeWriteOptions<L>,
    request?: ForgeRequestOptions
  ): Promise<ForgeWriteResult<S, TSlug, L>> {
    return this.data<ForgeWriteResult<S, TSlug, L>>({
      method: 'POST',
      url: this.content([this.collection(collection)], query(options)),
      json: data,
      failure: 'Failed to create document',
      signal: request?.signal
    });
  }

  /** `PUT` a partial update. Same `locale` and result rules as {@link createDocument}. */
  async updateDocument<
    TSlug extends ForgeCollectionSlug<S>,
    L extends string | undefined = undefined
  >(
    collection: TSlug,
    id: string,
    data: ForgeUpdateInput<S, NoInfer<TSlug>, NoInfer<L>>,
    options?: ForgeWriteOptions<L>,
    request?: ForgeRequestOptions
  ): Promise<ForgeWriteResult<S, TSlug, L>> {
    return this.data<ForgeWriteResult<S, TSlug, L>>({
      method: 'PUT',
      url: this.content(
        [this.collection(collection), encodePathSegment(id, 'document id')],
        query(options)
      ),
      json: data,
      failure: 'Failed to update document',
      signal: request?.signal
    });
  }

  /**
   * Sets a `drafts: true` document's `_status` (spec 052). Thin convenience over
   * {@link updateDocument} — every draft/publish UI otherwise repeats the same `{ _status }` literal.
   * A typed client accepts only the schema's drafts collections.
   */
  async setDocumentStatus<TSlug extends ForgeDraftsCollectionSlug<S> & ForgeCollectionSlug<S>>(
    collection: TSlug,
    id: string,
    status: 'draft' | 'published',
    request?: ForgeRequestOptions
  ): Promise<ForgeWriteResult<S, TSlug>> {
    return this.data<ForgeWriteResult<S, TSlug>>({
      method: 'PUT',
      url: this.content([this.collection(collection), encodePathSegment(id, 'document id')]),
      json: { _status: status },
      failure: 'Failed to update document',
      signal: request?.signal
    });
  }

  /**
   * Generates a preview of a document by merging stored data with unsaved changes.
   * Useful for live preview in the admin UI before saving.
   * If id is provided, merges changes with existing document. Otherwise, previews new document.
   * The result is not validated, so every field may be missing.
   */
  async previewDocument<TSlug extends ForgeCollectionSlug<S>, D extends 0 | 1 = 0>(
    collection: TSlug,
    data: ForgeUpdateInput<S, NoInfer<TSlug>>,
    options?: { id?: string; depth?: D },
    request?: ForgeRequestOptions
  ): Promise<Partial<ForgeDocument<S, TSlug, D>>> {
    const queryString = buildQueryString(
      options?.depth !== undefined ? { depth: options.depth } : undefined
    );
    const segments = options?.id
      ? [this.collection(collection), encodePathSegment(options.id, 'document id'), 'preview']
      : [this.collection(collection), 'preview'];
    return this.data<Partial<ForgeDocument<S, TSlug, D>>>({
      method: 'POST',
      url: this.content(segments, queryString),
      json: data,
      failure: 'Failed to preview document',
      signal: request?.signal
    });
  }

  async deleteDocument(
    collection: ForgeCollectionSlug<S>,
    id: string,
    request?: ForgeRequestOptions
  ): Promise<void> {
    await this.requester.send({
      method: 'DELETE',
      url: this.content([this.collection(collection), encodePathSegment(id, 'document id')]),
      failure: 'Failed to delete document',
      signal: request?.signal
    });
  }

  /**
   * `POST {authBaseUrl}/login` (default `/api/auth/login`). Returns `{ token, user }` unchanged
   * (Bearer-compatible), but a browser session should rely on the `Set-Cookie` header the server also
   * sends (spec 053) — see `ForgeAuthSession`, which calls this and ignores `token`. An HTTP failure is
   * an `ApiAuthActionError`; a failed login never counts as session expiry.
   */
  async login(
    email: string,
    password: string,
    request?: ForgeRequestOptions
  ): Promise<{ token: string; user: AuthUser }> {
    return this.data<{ token: string; user: AuthUser }>({
      method: 'POST',
      url: this.auth(['login']),
      json: { email, password },
      failure: 'Login failed',
      authAction: true,
      signal: request?.signal
    });
  }

  /**
   * `POST {authBaseUrl}/signup` (default `/api/auth/signup`) — `404`s if the server hasn't enabled
   * public signup. No `role` field.
   */
  async signup(
    input: { email: string; password: string; name?: string },
    request?: ForgeRequestOptions
  ): Promise<{ token: string; user: AuthUser }> {
    return this.data<{ token: string; user: AuthUser }>({
      method: 'POST',
      url: this.auth(['signup']),
      json: input,
      failure: 'Signup failed',
      authAction: true,
      signal: request?.signal
    });
  }

  /** `POST {authBaseUrl}/logout` (default `/api/auth/logout`) — clears the session cookie. `204` on success. */
  async logout(request?: ForgeRequestOptions): Promise<void> {
    await this.requester.send({
      method: 'POST',
      url: this.auth(['logout']),
      failure: 'Logout failed',
      authAction: true,
      signal: request?.signal
    });
  }

  async getUsers(request?: ForgeRequestOptions): Promise<AuthUser[]> {
    return this.data<AuthUser[]>({
      method: 'GET',
      url: this.auth(['users']),
      failure: 'Failed to fetch users',
      signal: request?.signal
    });
  }

  async createUser(input: CreateUserInput, request?: ForgeRequestOptions): Promise<AuthUser> {
    return this.data<AuthUser>({
      method: 'POST',
      url: this.auth(['users']),
      json: input,
      failure: 'Failed to create user',
      signal: request?.signal
    });
  }

  async updateUser(
    id: string,
    input: Partial<CreateUserInput>,
    request?: ForgeRequestOptions
  ): Promise<AuthUser> {
    return this.data<AuthUser>({
      method: 'PUT',
      url: this.auth(['users', encodePathSegment(id, 'user id')]),
      json: input,
      failure: 'Failed to update user',
      signal: request?.signal
    });
  }

  async deleteUser(id: string, request?: ForgeRequestOptions): Promise<void> {
    await this.requester.send({
      method: 'DELETE',
      url: this.auth(['users', encodePathSegment(id, 'user id')]),
      failure: 'Failed to delete user',
      signal: request?.signal
    });
  }

  // --- Globals -----------------------------------------------------------------------------

  /**
   * Reads a singleton global document (depth 0, no locale: localized fields are per-locale maps).
   * Returns `null` if the global has never been configured.
   */
  async getGlobal<TSlug extends ForgeGlobalSlug<S>>(
    global: TSlug,
    request?: ForgeRequestOptions
  ): Promise<ForgeGlobalDocument<S, TSlug> | null> {
    const failure = `Failed to fetch global '${global}'`;
    const body = await this.requester.send({
      method: 'GET',
      url: this.content(['globals', encodePathSegment(global, 'global slug')]),
      failure,
      passStatuses: [404],
      signal: request?.signal
    });
    if (body instanceof PassedStatus) return null;
    return dataOf<ForgeGlobalDocument<S, TSlug>>(body, failure);
  }

  /**
   * Creates or updates a singleton global document. Partial: omitted fields keep their stored values.
   */
  async updateGlobal<TSlug extends ForgeGlobalSlug<S>>(
    global: TSlug,
    data: ForgeGlobalInput<S, NoInfer<TSlug>>,
    request?: ForgeRequestOptions
  ): Promise<ForgeGlobalWriteResult<S, TSlug>> {
    return this.data<ForgeGlobalWriteResult<S, TSlug>>({
      method: 'PUT',
      url: this.content(['globals', encodePathSegment(global, 'global slug')]),
      json: data,
      failure: `Failed to update global '${global}'`,
      signal: request?.signal
    });
  }
}

/**
 * The injected {@link CmsApiService}, typed by a content model (spec 076). Same instance, same
 * transport and configuration as `inject(CmsApiService)` — only the types differ. Call in an injection
 * context (a field initializer, a constructor, `runInInjectionContext`).
 *
 * ```ts
 * private readonly cms = injectForgeClient<SiteSchema>();
 * const posts = await this.cms.getDocuments('posts', { where: { featured: true }, depth: 1 });
 * ```
 */
export function injectForgeClient<S extends ForgeSchema>(): CmsApiService<S> {
  return inject(CmsApiService) as unknown as CmsApiService<S>;
}

/**
 * The typed option objects are a refinement of {@link QueryOptions}; the query string builder only
 * needs the shared shape. (`locale?: L` admits `undefined` under `exactOptionalPropertyTypes`.)
 */
function query(options: object | undefined): string {
  return buildQueryString(options as QueryOptions | undefined);
}
