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
