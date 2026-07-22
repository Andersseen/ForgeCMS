import type { ForgeCmsConfig, AdapterSet } from './config.js';
import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import * as operations from './operations.js';
import type {
  CountArgs,
  CreateArgs,
  DeleteArgs,
  FindArgs,
  FindByIDArgs,
  PaginatedDocs,
  UpdateArgs
} from './operations.js';

/**
 * The CMS instance: collections bound to adapters, plus the **Local API** — `find`, `findByID`,
 * `create`, `update`, `delete`, `count`.
 *
 * The Local API is the primary way to use ForgeCMS from server code (an Analog.js `.server.ts`
 * route, a Nitro handler, a seed script). It runs the full pipeline — hooks, access, drafts,
 * relation population, validation — with no HTTP hop and no `Request` to fabricate. The HTTP
 * handlers in `handlers.ts` are a thin transport layer over these same methods.
 *
 * Access control is **skipped by default** here (`overrideAccess` defaults to `true`), because a
 * direct call comes from trusted server code. Pass `overrideAccess: false` together with a `user` to
 * run an operation as that user — which is exactly what the HTTP layer does.
 */
export class ForgeCmsRuntime<TEnv = unknown> implements OperationContext {
  readonly config: ForgeCmsConfig<TEnv>;
  readonly adapters: AdapterSet;

  constructor(config: ForgeCmsConfig<TEnv>) {
    this.config = config;
    this.adapters = config.adapters;
  }

  /** Initialise all adapters with the runtime environment */
  init(): this {
    const env = this.config.env;
    this.adapters.database.init(env);
    this.adapters.auth.init(env);
    this.adapters.storage.init(env);
    return this;
  }

  /** Sync database schema for all registered collections */
  async syncSchema(): Promise<void> {
    await this.adapters.database.syncSchema(this.config.collections);
  }

  /** Find a collection definition by slug */
  getCollection(slug: string): CollectionDefinition | undefined {
    return this.config.collections.find((c) => c.slug === slug);
  }

  /** Get all registered collection definitions */
  getCollections(): readonly CollectionDefinition[] {
    return this.config.collections;
  }

  // --- Local API ---------------------------------------------------------------------------

  find(args: FindArgs): Promise<PaginatedDocs> {
    return operations.find(this, args);
  }

  findByID(args: FindByIDArgs): Promise<DatabaseRecord> {
    return operations.findByID(this, args);
  }

  count(args: CountArgs): Promise<number> {
    return operations.count(this, args);
  }

  create(args: CreateArgs): Promise<DatabaseRecord> {
    return operations.create(this, args);
  }

  update(args: UpdateArgs): Promise<DatabaseRecord> {
    return operations.update(this, args);
  }

  delete(args: DeleteArgs): Promise<DatabaseRecord> {
    return operations.deleteDocument(this, args);
  }
}
