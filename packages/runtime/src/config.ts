import type { CollectionDefinition, CollectionRegistry, GlobalDefinition } from '@forge-cms/core';
import type { DatabaseAdapter } from '@forge-cms/db';
import type { AuthAdapter } from '@forge-cms/auth';
import type { StorageAdapter } from '@forge-cms/storage';

export interface AdapterSet {
  database: DatabaseAdapter;
  auth: AuthAdapter;
  storage: StorageAdapter;
}

export interface ForgeCmsConfig<
  TEnv = unknown,
  TCollections extends CollectionRegistry = CollectionDefinition[]
> {
  /** Schema definitions for all collections */
  collections: TCollections;
  /** Singleton documents (site-wide config: nav, footer, SEO defaults). */
  globals?: GlobalDefinition[];
  /** Adapter instances (must be initialised separately or via runtime.init()) */
  adapters: AdapterSet;
  /** Cloudflare/environment bindings passed to adapters */
  env?: TEnv;
}
