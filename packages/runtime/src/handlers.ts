import type { ApiContext, CrudHandlers } from '@forge-cms/api';
import type { ForgeCmsRuntime } from './runtime.js';

export interface CreateHandlersOptions<TEnv = unknown> {
  runtime: ForgeCmsRuntime<TEnv>;
}

/**
 * Build default CRUD handlers for a collection.
 *
 * This is intentionally a stub — real implementation will come when we wire
 * validation, auth, and database operations together.
 */
export function createCrudHandlers<TEnv = unknown>(
  _options: CreateHandlersOptions<TEnv>
): CrudHandlers<TEnv> {
  return {
    list: async (_context: ApiContext<TEnv>) => {
      return new Response(
        JSON.stringify({ status: 'not-implemented', handler: 'list' }),
        { status: 501, headers: { 'content-type': 'application/json' } }
      );
    },
    read: async (_context: ApiContext<TEnv>) => {
      return new Response(
        JSON.stringify({ status: 'not-implemented', handler: 'read' }),
        { status: 501, headers: { 'content-type': 'application/json' } }
      );
    },
    create: async (_context: ApiContext<TEnv>) => {
      return new Response(
        JSON.stringify({ status: 'not-implemented', handler: 'create' }),
        { status: 501, headers: { 'content-type': 'application/json' } }
      );
    },
    update: async (_context: ApiContext<TEnv>) => {
      return new Response(
        JSON.stringify({ status: 'not-implemented', handler: 'update' }),
        { status: 501, headers: { 'content-type': 'application/json' } }
      );
    },
    delete: async (_context: ApiContext<TEnv>) => {
      return new Response(
        JSON.stringify({ status: 'not-implemented', handler: 'delete' }),
        { status: 501, headers: { 'content-type': 'application/json' } }
      );
    }
  };
}
