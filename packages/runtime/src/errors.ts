import type { ValidationError } from '@forge-cms/core';

export type ForgeErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'UNKNOWN_FIELD'
  | 'INVALID_QUERY'
  | 'UNIQUE_CONSTRAINT'
  | 'AUTH_MANAGED_COLLECTION'
  | 'CONCURRENT_MODIFICATION'
  | 'INTERNAL_ERROR';

export class ForgeError extends Error {
  readonly status: number;
  readonly code: ForgeErrorCode;

  constructor(message: string, status: number, code: ForgeErrorCode) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends ForgeError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

export class InvalidInputError extends ForgeError {
  constructor(message: string) {
    super(message, 400, 'INVALID_INPUT');
  }
}

export class InvalidQueryError extends ForgeError {
  constructor(message: string) {
    super(message, 400, 'INVALID_QUERY');
  }
}

export class UnknownFieldError extends ForgeError {
  constructor(message: string) {
    super(message, 400, 'UNKNOWN_FIELD');
  }
}

export class ValidationFailedError extends ForgeError {
  readonly details: ValidationError[];

  constructor(details: ValidationError[]) {
    super('Document validation failed', 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class UnauthorizedError extends ForgeError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class AccessDeniedError extends ForgeError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * A mutating request authenticated only by the ambient Forge session cookie (no `Authorization`
 * header) whose `Origin`/`Referer` doesn't match the request's own host — see `csrf.ts`'s
 * `assertCsrfSafe`. A request authenticated via `Authorization: Bearer` is never subject to this
 * check, so no machine/API-key client is affected.
 */
export class CsrfError extends ForgeError {
  constructor(message = 'Cross-site request rejected') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * A `create`/`update` would violate a unique index — whether field-level `unique: true` or a
 * collection-level compound `indexes` entry. Every `DatabaseAdapter` (InMemory, libSQL, D1) surfaces
 * its own uniqueness conflict as `@forge-cms/db`'s `UniqueConstraintError`; `operations.ts` catches
 * that and rethrows this one, so callers only ever see this single, adapter-independent error.
 */
export class UniqueConstraintError extends ForgeError {
  readonly collection: string;
  readonly fields: string[];

  constructor(collection: string, fields: string[]) {
    super(
      fields.length > 0
        ? `A document with this ${fields.join('/')} combination already exists`
        : 'This document already exists',
      409,
      'UNIQUE_CONSTRAINT'
    );
    this.collection = collection;
    this.fields = fields;
  }
}

/**
 * A generic `create`/`update`/`delete` targeted a collection whose lifecycle the configured
 * `AuthAdapter` owns (`AuthAdapter.managesCollection`, spec 061). Those mutations would bypass the
 * adapter's invariants — first-admin provisioning, last-admin protection, password hashing, email
 * normalisation, session versioning — so they are refused for every caller, trusted (`overrideAccess:
 * true`) or not. Deliberately says nothing about which adapter or how; the way out is the auth
 * adapter's own user-management operations.
 */
export class AuthManagedCollectionError extends ForgeError {
  readonly collection: string;

  constructor(collection: string) {
    super(
      `Collection '${collection}' is managed by the configured auth adapter and cannot be mutated ` +
        `through generic collection CRUD. Use the auth adapter's user-management operations instead.`,
      403,
      'AUTH_MANAGED_COLLECTION'
    );
    this.collection = collection;
  }
}

/**
 * A versioned document mutation lost a race (spec 062): another write committed a new version of the
 * same document after this one read it, so this one's document write and snapshot were rolled back
 * together — nothing was written. Forge never retries it automatically (`before*` hooks may already
 * have run); re-read the document and submit again. Deliberately names the public collection slug,
 * never the internal `_versions_*` table whose unique index detected the conflict.
 */
export class ConcurrentModificationError extends ForgeError {
  readonly collection: string;
  readonly id: string;

  constructor(collection: string, id: string) {
    super(
      `Document '${id}' in '${collection}' was changed by another request while this one was in ` +
        `progress; nothing was written. Reload it and try again.`,
      409,
      'CONCURRENT_MODIFICATION'
    );
    this.collection = collection;
    this.id = id;
  }
}

export function isForgeError(err: unknown): err is ForgeError {
  return err instanceof ForgeError;
}

export interface ForgeApiErrorBody {
  error: {
    code: ForgeErrorCode;
    message: string;
    details?: unknown;
  };
}

export function toApiErrorBody(err: ForgeError): ForgeApiErrorBody {
  if (err instanceof ValidationFailedError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    };
  }
  if (err instanceof UniqueConstraintError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        details: { collection: err.collection, fields: err.fields }
      }
    };
  }
  return {
    error: {
      code: err.code,
      message: err.message
    }
  };
}
