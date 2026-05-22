import type { CollectionDefinition } from '@forge-cms/core';

export interface ApiContext<TEnv = unknown> {
  request: Request;
  params?: Record<string, string>;
  env: TEnv;
  executionCtx?: ExecutionContext;
}

export interface CrudHandlerConfig<
  TCollection extends CollectionDefinition = CollectionDefinition
> {
  collection: TCollection;
}

export interface CrudHandlers<TEnv = unknown> {
  list?: (context: ApiContext<TEnv>) => Promise<Response>;
  read?: (context: ApiContext<TEnv>) => Promise<Response>;
  create?: (context: ApiContext<TEnv>) => Promise<Response>;
  update?: (context: ApiContext<TEnv>) => Promise<Response>;
  delete?: (context: ApiContext<TEnv>) => Promise<Response>;
}

export function defineCrudHandlers<TCollection extends CollectionDefinition, TEnv = unknown>(
  config: CrudHandlerConfig<TCollection>,
  handlers: CrudHandlers<TEnv> = {}
): CrudHandlerConfig<TCollection> & { handlers: CrudHandlers<TEnv> } {
  return {
    ...config,
    handlers
  };
}
