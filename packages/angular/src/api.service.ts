import { Injectable, inject } from '@angular/core';
import { buildQueryString } from './query.js';
import type { QueryOptions } from './query.js';
import {
  ApiAuthError,
  ApiValidationError,
  FORGE_CMS_CONFIG,
  type ApiFieldError,
  type ApiItemResponse,
  type ApiListResponse,
  type AuthUser,
  type CollectionMeta,
  type CreateUserInput,
  type PaginatedDocuments
} from './types.js';

async function toApiError(response: Response, fallbackMessage: string): Promise<Error> {
  if (response.status === 401) {
    return new ApiAuthError();
  }
  try {
    const body = (await response.json()) as { error?: string; details?: ApiFieldError[] };
    if (body.details) {
      return new ApiValidationError(body.error ?? fallbackMessage, body.details);
    }
    return new Error(`${fallbackMessage}: ${response.status}`);
  } catch {
    return new Error(`${fallbackMessage}: ${response.status}`);
  }
}

@Injectable({ providedIn: 'root' })
export class CmsApiService {
  private readonly config = inject(FORGE_CMS_CONFIG, { optional: true });

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

  async getCurrentUser(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me', { headers: this.getHeaders() });
    if (!response.ok) return null;
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async getCollections(): Promise<CollectionMeta[]> {
    const response = await fetch(`${this.baseUrl}/collections`, { headers: this.authHeader() });
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
      headers: this.authHeader()
    });
    if (!response.ok) throw await toApiError(response, `Failed to fetch ${collection}`);
    const result = (await response.json()) as ApiListResponse<T>;
    return { docs: result.data, meta: result.meta };
  }

  async getDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    options?: Pick<QueryOptions, 'depth'>
  ): Promise<T> {
    const response = await fetch(
      `${this.baseUrl}/${collection}/${id}${buildQueryString(options)}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw await toApiError(response, 'Failed to fetch document');
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
      body: form
    });
    if (!response.ok) throw await toApiError(response, 'Failed to upload file');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async createDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await toApiError(response, 'Failed to create document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async updateDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await toApiError(response, 'Failed to update document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
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
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await toApiError(response, 'Failed to preview document');
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!response.ok) throw await toApiError(response, 'Failed to delete document');
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) throw await toApiError(response, 'Login failed');
    const result = (await response.json()) as { data: { token: string; user: AuthUser } };
    return result.data;
  }

  async getUsers(): Promise<AuthUser[]> {
    const response = await fetch('/api/auth/users', { headers: this.getHeaders() });
    if (!response.ok) throw await toApiError(response, 'Failed to fetch users');
    const result = (await response.json()) as { data: AuthUser[] };
    return result.data;
  }

  async createUser(input: CreateUserInput): Promise<AuthUser> {
    const response = await fetch('/api/auth/users', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await toApiError(response, 'Failed to create user');
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async updateUser(id: string, input: Partial<CreateUserInput>): Promise<AuthUser> {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await toApiError(response, 'Failed to update user');
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async deleteUser(id: string): Promise<void> {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!response.ok) throw await toApiError(response, 'Failed to delete user');
  }

  // --- Globals -----------------------------------------------------------------------------

  /**
   * Reads a singleton global document. Returns `null` if the global has never been configured.
   */
  async getGlobal<T = Record<string, unknown>>(global: string): Promise<T | null> {
    const response = await fetch(`${this.baseUrl}/globals/${global}`, {
      headers: this.authHeader()
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await toApiError(response, `Failed to fetch global '${global}'`);
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
      body: JSON.stringify(data)
    });
    if (!response.ok) throw await toApiError(response, `Failed to update global '${global}'`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }
}
