import { Injectable, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { buildQueryString } from './query.js';
import type { QueryOptions, QueryWhere } from './query.js';
import {
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  FORGE_CMS_CONFIG,
  type ApiErrorBody,
  type ApiFieldError,
  type ApiItemResponse,
  type ApiListResponse,
  type AuthUser,
  type CollectionMeta,
  type CreateUserInput,
  type PaginatedDocuments
} from './types.js';

@Injectable({ providedIn: 'root' })
export class CmsApiService {
  private readonly config = inject(FORGE_CMS_CONFIG, { optional: true });

  /** Bumped once per observed `401` — a signal for any UI that wants to react to it generically. */
  private readonly unauthorizedCount = signal(0);
  readonly unauthorized: Signal<number> = this.unauthorizedCount.asReadonly();

  /**
   * Plain callback registry `ForgeAuthSession` uses to detect a session going stale mid-app (a 401 on
   * some unrelated request) without polling `/api/auth/me` in a loop — see `auth-session.ts`. A plain
   * callback rather than an `effect()` on {@link unauthorized}: `effect()` needs the full Angular
   * change-detection scheduler wired up (a real bootstrapped app, or `TestBed` with a platform), which
   * this package's lightweight `Injector.create`-based tests don't set up, and a synchronous callback is
   * simpler to reason about here regardless.
   */
  private readonly unauthorizedListeners = new Set<() => void>();

  /** Registers a listener called synchronously on every observed `401`. Returns an unsubscribe function. */
  onUnauthorized(listener: () => void): () => void {
    this.unauthorizedListeners.add(listener);
    return () => this.unauthorizedListeners.delete(listener);
  }

  private get baseUrl(): string {
    return this.config?.baseUrl ?? '/api/v1';
  }

  private get authToken(): string | null {
    const token = this.config?.authToken;
    if (typeof token === 'function') return token();
    return token ?? null;
  }

  private getHeaders(): Record<string, string> {
    return { 'content-type': 'application/json', ...this.authHeader() };
  }

  /**
   * The auth header alone, for requests that must not declare a JSON content type (a `GET`, or a
   * multipart upload where the browser has to set the boundary itself).
   */
  private authHeader(): Record<string, string> {
    const token = this.authToken;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  /**
   * Turns a non-2xx response into an `Error`. Handles every shape this codebase's routes actually
   * produce: the current Forge envelope (`{ error: { code, message, details? } }`, from
   * `handlers.ts`/`auth-handlers.ts`/`authFailureResponse` — note `details` nests *inside* `error`,
   * not at the top level), an older flat shape (`{ error: string, details: [...] }`, kept for backward
   * compatibility), and h3's own `createError` shape (`{ statusMessage, message }`, used by the
   * hand-rolled `apps/*` user-management routes for their own local validation). Without unwrapping
   * the nested object form, a real per-field validation array or a real message like "Cannot remove
   * the last remaining admin" previously surfaced as the useless string `"[object Object]"`.
   */
  private toApiError = async (response: Response, fallbackMessage: string): Promise<Error> => {
    if (response.status === 401) {
      this.unauthorizedCount.update((count) => count + 1);
      for (const listener of this.unauthorizedListeners) listener();
      return new ApiAuthError();
    }
    try {
      const body = (await response.json()) as {
        error?: string | { code?: string; message?: string; details?: unknown };
        details?: ApiFieldError[];
        statusMessage?: string;
        message?: string;
      };
      const errorObject =
        typeof body.error === 'object' && body.error !== null ? body.error : undefined;
      const errorString = typeof body.error === 'string' ? body.error : undefined;
      const details = (errorObject?.details as ApiFieldError[] | undefined) ?? body.details;

      if (Array.isArray(details)) {
        return new ApiValidationError(
          errorObject?.message ?? errorString ?? fallbackMessage,
          details
        );
      }
      const text = errorObject?.message ?? errorString ?? body.statusMessage ?? body.message;
      if (text) return new Error(text);
      return new Error(`${fallbackMessage}: ${response.status}`);
    } catch {
      return new Error(`${fallbackMessage}: ${response.status}`);
    }
  };

  private async toAuthActionError(
    response: Response,
    fallbackMessage: string
  ): Promise<ApiAuthActionError> {
    try {
      const body = (await response.json()) as Partial<ApiErrorBody>;
      if (body.error?.message) {
        return new ApiAuthActionError(
          body.error.code ?? 'UNKNOWN',
          body.error.message,
          response.status
        );
      }
    } catch {
      // fall through to the generic fallback below
    }
    return new ApiAuthActionError('UNKNOWN', fallbackMessage, response.status);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me', {
      headers: this.getHeaders(),
      credentials: 'include'
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async getCollections(): Promise<CollectionMeta[]> {
    const response = await fetch(`${this.baseUrl}/collections`, {
      headers: this.authHeader(),
      credentials: 'include'
    });
    if (!response.ok) throw new Error(`Failed to fetch collections: ${response.status}`);
    const result = (await response.json()) as { data: CollectionMeta[] };
    return result.data;
  }

  /**
   * Lists documents. Everything the API supports — filters, sorting, pagination, `depth`, draft
   * visibility — goes through {@link QueryOptions}.
   */
  async getDocuments<T = Record<string, unknown>>(
    collection: string,
    options?: QueryOptions
  ): Promise<T[]> {
    const { docs } = await this.listDocuments<T>(collection, options);
    return docs;
  }

  /** Like {@link getDocuments}, but keeps the pagination metadata a paginator needs. */
  async listDocuments<T = Record<string, unknown>>(
    collection: string,
    options?: QueryOptions
  ): Promise<PaginatedDocuments<T>> {
    const response = await fetch(`${this.baseUrl}/${collection}${buildQueryString(options)}`, {
      headers: this.authHeader(),
      credentials: 'include'
    });
    if (!response.ok) throw await this.toApiError(response, `Failed to fetch ${collection}`);
    const result = (await response.json()) as ApiListResponse<T>;
    return { docs: result.data, meta: result.meta };
  }

  /**
   * The first document matching `where`, or `null` if none does (spec 050 §18). No dedicated server
   * route: this calls the existing list endpoint with `limit: 1` and returns its first result — the
   * Local API's `findOne()` is the important primitive; this is client convenience over it.
   */
  async findOne<T = Record<string, unknown>>(
    collection: string,
    where?: QueryWhere,
    options?: Omit<QueryOptions, 'where' | 'limit' | 'offset' | 'page'>
  ): Promise<T | null> {
    const { docs } = await this.listDocuments<T>(collection, {
      ...options,
      ...(where !== undefined && { where }),
      limit: 1
    });
    return docs[0] ?? null;
  }

  async getDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    options?: Pick<QueryOptions, 'depth' | 'locale'>
  ): Promise<T> {
    const response = await fetch(
      `${this.baseUrl}/${collection}/${id}${buildQueryString(options)}`,
      { headers: this.authHeader(), credentials: 'include' }
    );
    if (!response.ok) throw await this.toApiError(response, 'Failed to fetch document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  /**
   * Uploads a file to an `upload: true` collection (the multipart path from spec 016).
   *
   * The content type is deliberately not set: the browser has to add the multipart boundary.
   */
  async uploadFile<T = Record<string, unknown>>(
    collection: string,
    file: File,
    fields: Record<string, string> = {}
  ): Promise<T> {
    const form = new FormData();
    form.set('file', file);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);

    const response = await fetch(`${this.baseUrl}/${collection}`, {
      method: 'POST',
      headers: this.authHeader(),
      credentials: 'include',
      body: form
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to upload file');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async createDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>,
    options?: Pick<QueryOptions, 'locale'>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}${buildQueryString(options)}`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to create document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async updateDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    options?: Pick<QueryOptions, 'locale'>
  ): Promise<T> {
    const response = await fetch(
      `${this.baseUrl}/${collection}/${id}${buildQueryString(options)}`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
      }
    );
    if (!response.ok) throw await this.toApiError(response, 'Failed to update document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  /**
   * Sets a `drafts: true` document's `_status` (spec 052). Thin convenience over
   * {@link updateDocument} — every draft/publish UI otherwise repeats the same `{ _status }` literal.
   */
  async setDocumentStatus<T = Record<string, unknown>>(
    collection: string,
    id: string,
    status: 'draft' | 'published'
  ): Promise<T> {
    return this.updateDocument<T>(collection, id, { _status: status });
  }

  /**
   * Generates a preview of a document by merging stored data with unsaved changes.
   * Useful for live preview in the admin UI before saving.
   * If id is provided, merges changes with existing document. Otherwise, previews new document.
   */
  async previewDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>,
    options?: { id?: string; depth?: 0 | 1 }
  ): Promise<T> {
    const url = options?.id
      ? `${this.baseUrl}/${collection}/${options.id}/preview${buildQueryString(options.depth !== undefined ? { depth: options.depth } : undefined)}`
      : `${this.baseUrl}/${collection}/preview${buildQueryString(options?.depth !== undefined ? { depth: options.depth } : undefined)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to preview document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      credentials: 'include'
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to delete document');
  }

  /**
   * `POST /api/auth/login`. Returns `{ token, user }` unchanged (Bearer-compatible), but a browser
   * session should rely on the `Set-Cookie` header the server also sends (spec 053) — see
   * `ForgeAuthSession`, which calls this and ignores `token`.
   */
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) throw await this.toAuthActionError(response, 'Login failed');
    const result = (await response.json()) as { data: { token: string; user: AuthUser } };
    return result.data;
  }

  /** `POST /api/auth/signup` — `404`s if the server hasn't enabled public signup. No `role` field. */
  async signup(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<{ token: string; user: AuthUser }> {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await this.toAuthActionError(response, 'Signup failed');
    const result = (await response.json()) as { data: { token: string; user: AuthUser } };
    return result.data;
  }

  /** `POST /api/auth/logout` — clears the session cookie. `204` on success. */
  async logout(): Promise<void> {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    if (!response.ok) throw await this.toAuthActionError(response, 'Logout failed');
  }

  async getUsers(): Promise<AuthUser[]> {
    const response = await fetch('/api/auth/users', {
      headers: this.getHeaders(),
      credentials: 'include'
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to fetch users');
    const result = (await response.json()) as { data: AuthUser[] };
    return result.data;
  }

  async createUser(input: CreateUserInput): Promise<AuthUser> {
    const response = await fetch('/api/auth/users', {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to create user');
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser> {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to update user');
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async deleteUser(id: string): Promise<void> {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      credentials: 'include'
    });
    if (!response.ok) throw await this.toApiError(response, 'Failed to delete user');
  }

  // --- Globals -----------------------------------------------------------------------------

  /**
   * Reads a singleton global document. Returns `null` if the global has never been configured.
   */
  async getGlobal<T = Record<string, unknown>>(global: string): Promise<T | null> {
    const response = await fetch(`${this.baseUrl}/globals/${global}`, {
      headers: this.authHeader(),
      credentials: 'include'
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.toApiError(response, `Failed to fetch global '${global}'`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  /**
   * Creates or updates a singleton global document.
   */
  async updateGlobal<T = Record<string, unknown>>(
    global: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/globals/${global}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await this.toApiError(response, `Failed to update global '${global}'`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }
}
