import type { ValidationError } from '@forge-cms/core';

export type ForgeErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'UNKNOWN_FIELD'
  | 'INVALID_QUERY'
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
  return {
    error: {
      code: err.code,
      message: err.message
    }
  };
}
