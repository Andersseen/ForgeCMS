import type { ValidationError } from '@forge-cms/core';

/**
 * Base class for every error the Local API throws. `status` is the HTTP status the HTTP layer maps
 * it to — the operations themselves stay transport-agnostic, but they know how serious a failure is,
 * and duplicating that judgement in the route layer is how the two drift apart.
 */
export class ForgeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** 404 — the collection or the document does not exist (or must be indistinguishable from that). */
export class NotFoundError extends ForgeError {
  constructor(message: string) {
    super(message, 404);
  }
}

/** 400 — the request itself is malformed (bad JSON, unknown sort field, uncoercible filter). */
export class InvalidInputError extends ForgeError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** 400 — the payload is well-formed but fails the collection's schema. */
export class ValidationFailedError extends ForgeError {
  readonly details: ValidationError[];

  constructor(details: ValidationError[]) {
    super('Validation failed', 400);
    this.details = details;
  }
}

/** 401 — no valid credentials were presented. */
export class UnauthorizedError extends ForgeError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/** 403 — credentials are valid but this user may not do this. */
export class AccessDeniedError extends ForgeError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export function isForgeError(err: unknown): err is ForgeError {
  return err instanceof ForgeError;
}
