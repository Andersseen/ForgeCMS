import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Provider } from '@angular/core';

export interface ApiListResponse<T> {
  data: T[];
  meta: {
    collection: string;
    count: number;
    limit?: number;
    offset?: number;
  };
}

export interface ApiItemResponse<T> {
  data: T;
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
}

export interface CollectionMeta {
  slug: string;
  name: string;
  description: string;
  fieldDefinitions: FieldMeta[];
}

export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

/**
 * Thrown by createDocument/updateDocument when the server responds with per-field validation
 * errors, matching ARCHITECTURE.md's documented envelope: `{ error: string, details:
 * ApiFieldError[] }`.
 */
export class ApiValidationError extends Error {
  constructor(
    message: string,
    readonly details: ApiFieldError[]
  ) {
    super(message);
    this.name = 'ApiValidationError';
  }
}

/** Thrown by write methods when the server responds `401` — the caller isn't authenticated. */
export class ApiAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'ApiAuthError';
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

export interface ForgeCmsConfig {
  baseUrl: string;
  authToken?: string | (() => string | null);
}

export const FORGE_CMS_CONFIG = new InjectionToken<ForgeCmsConfig>('FORGE_CMS_CONFIG');

export function provideForgeCms(config: ForgeCmsConfig): Provider[] {
  return [{ provide: FORGE_CMS_CONFIG, useValue: config }];
}

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
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.authToken;
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me', { headers: this.getHeaders() });
    if (!response.ok) return null;
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async getCollections(): Promise<CollectionMeta[]> {
    const response = await fetch(`${this.baseUrl}/collections`);
    if (!response.ok) throw new Error(`Failed to fetch collections: ${response.status}`);
    const result = (await response.json()) as { data: CollectionMeta[] };
    return result.data;
  }

  async getDocuments<T = Record<string, unknown>>(collection: string): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/${collection}`);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
    const result = (await response.json()) as ApiListResponse<T>;
    return result.data;
  }

  async getDocument<T = Record<string, unknown>>(collection: string, id: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`);
    if (!response.ok) throw new Error(`Failed to fetch document: ${response.status}`);
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
}
