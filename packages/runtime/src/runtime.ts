import type { ForgeCmsConfig, AdapterSet } from './config.js';
import type {
  CollectionBySlug,
  CollectionDefinition,
  CollectionDocument,
  CollectionRegistry,
  CollectionSlug,
  GlobalDefinition,
  AnyField
} from '@forge-cms/core';
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
  UpdateArgs
} from './operations.js';
import type {
  TypedCountArgs,
  TypedCreateArgs,
  TypedDeleteArgs,
  TypedFindArgs,
  TypedFindByIDArgs,
  TypedPaginatedDocs,
  TypedPreviewArgs,
  TypedUpdateArgs
} from './typed-api.js';
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
export class ForgeCmsRuntime<
  TEnv = unknown,
  TCollections extends CollectionRegistry = CollectionDefinition[]
> implements OperationContext {
  readonly config: ForgeCmsConfig<TEnv, TCollections>;
  readonly adapters: AdapterSet;

  constructor(config: ForgeCmsConfig<TEnv, TCollections>) {
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
    await this.adapters.auth.syncSchema?.();

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
  //
  // Each method delegates to the untyped `operations.*` function (unchanged, no runtime behavior
  // difference) and casts only the return value — `args` widens into the untyped parameter type with
  // no cast needed, since a narrower/more-specific object always satisfies a wider one. The cast on
  // the way out is the one isolated, justified spot per collection: `operations.*` genuinely returns
  // the right shape at runtime, it just doesn't carry the type to prove it statically.

  find<TSlug extends CollectionSlug<TCollections>>(
    args: TypedFindArgs<TCollections, TSlug>
  ): Promise<TypedPaginatedDocs<TCollections, TSlug>> {
    return operations.find(this, args as FindArgs) as Promise<
      TypedPaginatedDocs<TCollections, TSlug>
    >;
  }

  findByID<TSlug extends CollectionSlug<TCollections>>(
    args: TypedFindByIDArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    return operations.findByID(this, args as FindByIDArgs) as Promise<
      CollectionDocument<CollectionBySlug<TCollections, TSlug>>
    >;
  }

  count<TSlug extends CollectionSlug<TCollections>>(
    args: TypedCountArgs<TCollections, TSlug>
  ): Promise<number> {
    return operations.count(this, args as CountArgs);
  }

  create<TSlug extends CollectionSlug<TCollections>>(
    args: TypedCreateArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    return operations.create(this, args as CreateArgs) as Promise<
      CollectionDocument<CollectionBySlug<TCollections, TSlug>>
    >;
  }

  update<TSlug extends CollectionSlug<TCollections>>(
    args: TypedUpdateArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    return operations.update(this, args as UpdateArgs) as Promise<
      CollectionDocument<CollectionBySlug<TCollections, TSlug>>
    >;
  }

  delete<TSlug extends CollectionSlug<TCollections>>(
    args: TypedDeleteArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    return operations.deleteDocument(this, args as DeleteArgs) as Promise<
      CollectionDocument<CollectionBySlug<TCollections, TSlug>>
    >;
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

  // --- Preview ----------------------------------------------------------------------------

  /**
   * Generates a preview of a document by merging stored data with unsaved changes.
   * If id is provided, merges changes with existing document. Otherwise, previews new document.
   */
  async preview<TSlug extends CollectionSlug<TCollections>>(
    args: TypedPreviewArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    const collection = this.getCollection(args.collection);
    if (!collection) {
      throw new (await import('./errors.js')).NotFoundError(
        `Collection '${args.collection}' not found`
      );
    }

    let previewData: Record<string, unknown>;
    let existing: DatabaseRecord | null = null;

    if (args.id) {
      existing = await this.adapters.database.findById(args.collection, args.id);
      if (!existing) {
        throw new (await import('./errors.js')).NotFoundError(`Document '${args.id}' not found`);
      }
      previewData = { ...existing, ...args.data };
    } else {
      previewData = args.data;
    }

    // Apply field defaults and auto-slugs
    const { applyFieldDefaults, applyAutoSlugs } = await import('./defaults.js');
    previewData = applyAutoSlugs(
      collection,
      applyFieldDefaults(collection, previewData),
      existing ?? undefined
    );

    // Populate relations if depth > 0
    if (args.depth && args.depth > 0) {
      const { populateRecord } = await import('./populate.js');
      previewData = await populateRecord(previewData, collection, this);
    }

    return previewData as CollectionDocument<CollectionBySlug<TCollections, TSlug>>;
  }
}

/**
 * The HTTP-transport-facing view of a runtime. Collection slugs at this boundary are plain runtime
 * strings from a URL and can never be statically narrowed, so this pins the registry to `any` rather
 * than the class's own concrete broad default. Assigning a genuinely-typed `ForgeCmsRuntime<Env,
 * MyCollections>` instance into `ForgeCmsRuntime<Env>` (i.e. `ForgeCmsRuntime<Env,
 * CollectionDefinition[]>`) fails TypeScript's structural check of the typed methods' return types;
 * assigning it here does not, and nothing downstream needs to change once a value's static type is
 * this alias — see spec 047's Design section for the full explanation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate escape hatch, see comment above
export type AnyForgeCmsRuntime<TEnv = unknown> = ForgeCmsRuntime<TEnv, any>;
