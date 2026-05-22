import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter } from '@forge-cms/db';
import type { AuthAdapter } from '@forge-cms/auth';
import type { StorageAdapter } from '@forge-cms/storage';

export interface AdapterSet {
  database: DatabaseAdapter;
  auth: AuthAdapter;
  storage: StorageAdapter;
}

export interface ForgeCmsConfig<TEnv = unknown> {
  /** Schema definitions for all collections */
  collections: CollectionDefinition[];
  /** Adapter instances (must be initialised separately or via runtime.init()) */
  adapters: AdapterSet;
  /** Cloudflare/environment bindings passed to adapters */
  env?: TEnv;
}
