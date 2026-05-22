import type { ForgeCmsConfig, AdapterSet } from './config.js';
import type { CollectionDefinition } from '@forge-cms/core';

export class ForgeCmsRuntime<TEnv = unknown> {
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
}
