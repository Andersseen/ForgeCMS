import type { CollectionDefinition } from '@devflare-cms/core';

export interface ApiContext {
  request: Request;
  params?: Record<string, string>;
}

export interface CrudHandlerConfig<
  TCollection extends CollectionDefinition = CollectionDefinition
> {
  collection: TCollection;
}

export interface CrudHandlers {
  list?: (context: ApiContext) => Promise<Response>;
  read?: (context: ApiContext) => Promise<Response>;
  create?: (context: ApiContext) => Promise<Response>;
  update?: (context: ApiContext) => Promise<Response>;
  delete?: (context: ApiContext) => Promise<Response>;
}

export function defineCrudHandlers<TCollection extends CollectionDefinition>(
  config: CrudHandlerConfig<TCollection>,
  handlers: CrudHandlers = {}
): CrudHandlerConfig<TCollection> & { handlers: CrudHandlers } {
  return {
    ...config,
    handlers
  };
}
