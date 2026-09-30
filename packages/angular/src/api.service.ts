import { Injectable, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { buildQueryString } from './query.js';
import type { QueryOptions, QueryWhere } from './query.js';
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

/**
 * Promise-based client for Forge's HTTP API. Every method sends exactly one request through the
 * configured transport (spec 075) and never retries. Every failure rejects with a `ForgeApiError`
 * (or one of its compatible subclasses) that keeps the HTTP status, Forge `code` and `details`.
 */
@Injectable({ providedIn: 'root' })
export class CmsApiService {
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
   * visibility — goes through {@link QueryOptions}.
   */
  async getDocuments<T = Record<string, unknown>>(
    collection: string,
    options?: QueryOptions,
    request?: ForgeRequestOptions
  ): Promise<T[]> {
    const { docs } = await this.listDocuments<T>(collection, options, request);
    return docs;
  }

  /** Like {@link getDocuments}, but keeps the pagination metadata a paginator needs. */
  async listDocuments<T = Record<string, unknown>>(
    collection: string,
    options?: QueryOptions,
    request?: ForgeRequestOptions
  ): Promise<PaginatedDocuments<T>> {
    const failure = `Failed to fetch ${collection}`;
    const body = await this.requester.send({
      method: 'GET',
      url: this.content([this.collection(collection)], buildQueryString(options)),
      failure,
      signal: request?.signal
    });
    const docs = dataOf<T[]>(body, failure);
    return { docs, meta: (body as ApiListResponse<T>).meta };
  }

  /**
   * The first document matching `where`, or `null` if none does (spec 050 §18). No dedicated server
   * route: this calls the existing list endpoint with `limit: 1` and returns its first result — the
   * Local API's `findOne()` is the important primitive; this is client convenience over it.
   */
  async findOne<T = Record<string, unknown>>(
    collection: string,
    where?: QueryWhere,
    options?: Omit<QueryOptions, 'where' | 'limit' | 'offset' | 'page'>,
    request?: ForgeRequestOptions
  ): Promise<T | null> {
    const { docs } = await this.listDocuments<T>(
      collection,
      { ...options, ...(where !== undefined && { where }), limit: 1 },
      request
    );
    return docs[0] ?? null;
  }

  async getDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    options?: Pick<QueryOptions, 'depth' | 'locale'>,
    request?: ForgeRequestOptions
  ): Promise<T> {
    return this.data<T>({
      method: 'GET',
      url: this.content(
        [this.collection(collection), encodePathSegment(id, 'document id')],
        buildQueryString(options)
      ),
      failure: 'Failed to fetch document',
      signal: request?.signal
    });
  }

  /**
   * Uploads a file to an `upload: true` collection (the multipart path from spec 016).
   *
   * The content type is deliberately not set: the browser has to add the multipart boundary.
   */
  async uploadFile<T = Record<string, unknown>>(
    collection: string,
    file: File,
    fields: Record<string, string> = {},
    request?: ForgeRequestOptions
  ): Promise<T> {
    const form = new FormData();
    form.set('file', file);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);

    return this.data<T>({
      method: 'POST',
      url: this.content([this.collection(collection)]),
      body: form,
      failure: 'Failed to upload file',
      signal: request?.signal
    });
  }

  async createDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>,
    options?: Pick<QueryOptions, 'locale'>,
    request?: ForgeRequestOptions
  ): Promise<T> {
    return this.data<T>({
      method: 'POST',
      url: this.content([this.collection(collection)], buildQueryString(options)),
      json: data,
      failure: 'Failed to create document',
      signal: request?.signal
    });
  }

  async updateDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    options?: Pick<QueryOptions, 'locale'>,
    request?: ForgeRequestOptions
  ): Promise<T> {
    return this.data<T>({
      method: 'PUT',
      url: this.content(
        [this.collection(collection), encodePathSegment(id, 'document id')],
        buildQueryString(options)
      ),
      json: data,
      failure: 'Failed to update document',
      signal: request?.signal
    });
  }

  /**
   * Sets a `drafts: true` document's `_status` (spec 052). Thin convenience over
   * {@link updateDocument} — every draft/publish UI otherwise repeats the same `{ _status }` literal.
   */
  async setDocumentStatus<T = Record<string, unknown>>(
    collection: string,
    id: string,
    status: 'draft' | 'published',
    request?: ForgeRequestOptions
  ): Promise<T> {
    return this.updateDocument<T>(collection, id, { _status: status }, undefined, request);
  }

  /**
   * Generates a preview of a document by merging stored data with unsaved changes.
   * Useful for live preview in the admin UI before saving.
   * If id is provided, merges changes with existing document. Otherwise, previews new document.
   */
  async previewDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>,
    options?: { id?: string; depth?: 0 | 1 },
    request?: ForgeRequestOptions
  ): Promise<T> {
    const query = buildQueryString(
      options?.depth !== undefined ? { depth: options.depth } : undefined
    );
    const segments = options?.id
      ? [this.collection(collection), encodePathSegment(options.id, 'document id'), 'preview']
      : [this.collection(collection), 'preview'];
    return this.data<T>({
      method: 'POST',
      url: this.content(segments, query),
      json: data,
      failure: 'Failed to preview document',
      signal: request?.signal
    });
  }

  async deleteDocument(
    collection: string,
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
   * Reads a singleton global document. Returns `null` if the global has never been configured.
   */
  async getGlobal<T = Record<string, unknown>>(
    global: string,
    request?: ForgeRequestOptions
  ): Promise<T | null> {
    const failure = `Failed to fetch global '${global}'`;
    const body = await this.requester.send({
      method: 'GET',
      url: this.content(['globals', encodePathSegment(global, 'global slug')]),
      failure,
      passStatuses: [404],
      signal: request?.signal
    });
    if (body instanceof PassedStatus) return null;
    return dataOf<T>(body, failure);
  }

  /**
   * Creates or updates a singleton global document.
   */
  async updateGlobal<T = Record<string, unknown>>(
    global: string,
    data: Record<string, unknown>,
    request?: ForgeRequestOptions
  ): Promise<T> {
    return this.data<T>({
      method: 'PUT',
      url: this.content(['globals', encodePathSegment(global, 'global slug')]),
      json: data,
      failure: `Failed to update global '${global}'`,
      signal: request?.signal
    });
  }
}
