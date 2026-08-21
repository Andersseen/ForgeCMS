import type { ForgeCmsConfig, AdapterSet } from './config.js';
import type { CollectionDefinition, GlobalDefinition, AnyField } from '@forge-cms/core';
import { defineField } from '@forge-cms/core';
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
import * as globalOps from './globals.js';
import type { GetGlobalArgs, UpdateGlobalArgs } from './globals.js';
import * as versionOps from './versions.js';
import type {
  ListVersionsArgs,
  GetVersionArgs,
  RestoreVersionArgs,
  CreateVersionArgs
} from './versions.js';
import type { Version } from '@forge-cms/core';

/**
 * The CMS instance: collections bound to adapters, plus the **Local API** — `find`, `findByID`,
 * `create`, `update`, `delete`, `count`, `getGlobal`, `updateGlobal`.
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

  /** Sync database schema for all registered collections and globals */
  async syncSchema(): Promise<void> {
    await this.adapters.database.syncSchema(this.config.collections);

    for (const global of this.config.globals ?? []) {
      await this.adapters.database.syncSchema([
        {
          slug: `_global_${global.slug}`,
          fields: global.fields,
          ...(global.drafts === true && { drafts: true })
        }
      ]);
    }

    // Create version tables for collections with versions enabled
    for (const collection of this.config.collections) {
      if (
        collection.versions === true ||
        (typeof collection.versions === 'object' && collection.versions !== null)
      ) {
        const versionFields: Record<string, AnyField> = {
          documentId: defineField.text({ required: true }),
          versionNumber: defineField.number({ required: true }),
          data: defineField.json({ required: true }),
          createdAt: defineField.date({ required: true }),
          createdBy: defineField.text(),
          autosave: defineField.boolean(),
          label: defineField.text()
        };

        await this.adapters.database.syncSchema([
          {
            slug: `_versions_${collection.slug}`,
            fields: versionFields
          }
        ]);
      }
    }
  }

  /** Find a collection definition by slug */
  getCollection(slug: string): CollectionDefinition | undefined {
    return this.config.collections.find((c) => c.slug === slug);
  }

  /** Get all registered collection definitions */
  getCollections(): readonly CollectionDefinition[] {
    return this.config.collections;
  }

  /** Find a global definition by slug */
  getGlobal(slug: string): GlobalDefinition | undefined {
    return this.config.globals?.find((g) => g.slug === slug);
  }

  /** Get all registered global definitions */
  getGlobals(): readonly GlobalDefinition[] {
    return this.config.globals ?? [];
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

  // --- Globals -----------------------------------------------------------------------------

  getGlobalDocument(args: GetGlobalArgs): Promise<DatabaseRecord | null> {
    return globalOps.getGlobal(this, args);
  }

  updateGlobalDocument(args: UpdateGlobalArgs): Promise<DatabaseRecord> {
    return globalOps.updateGlobal(this, args);
  }

  // --- Versions ---------------------------------------------------------------------------

  listVersions(args: ListVersionsArgs): Promise<Version[]> {
    return versionOps.listVersions(this, args);
  }

  getVersion(args: GetVersionArgs): Promise<Version> {
    return versionOps.getVersion(this, args);
  }

  restoreVersion(args: RestoreVersionArgs): Promise<DatabaseRecord> {
    return versionOps.restoreVersion(this, args);
  }

  createVersion(args: CreateVersionArgs): Promise<Version> {
    return versionOps.createVersion(this, args);
  }
}
