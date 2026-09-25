import type { ForgeCmsConfig, AdapterSet } from './config.js';
import type {
  CollectionBySlug,
  CollectionDefinition,
  CollectionDocument,
  CollectionRegistry,
  CollectionSlug,
  GlobalDefinition
} from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import * as operations from './operations.js';
import type {
  CountArgs,
  CreateArgs,
  DeleteArgs,
  FindArgs,
  FindByIDArgs,
  FindOneArgs,
  UpdateArgs
} from './operations.js';
import type {
  TypedCountArgs,
  TypedCreateArgs,
  TypedDeleteArgs,
  TypedFindArgs,
  TypedFindByIDArgs,
  TypedFindOneArgs,
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

    // Version tables for collections with versions enabled (spec 062 §1/§8).
    const versioned = this.config.collections.filter((c) => versionOps.versionsEnabled(c));
    if (versioned.length > 0) {
      const database = this.adapters.database as Partial<typeof this.adapters.database>;
      if (typeof database.atomicWrite !== 'function') {
        throw new Error(
          `Collections with versions enabled (${versioned.map((c) => `'${c.slug}'`).join(', ')}) ` +
            `require a DatabaseAdapter implementing atomicWrite() — a document and its version ` +
            `snapshot must commit together (specs 060/062); '${String(database.name)}' does not.`
        );
      }
    }
    for (const collection of versioned) {
      await this.syncVersionTable(collection);
    }
  }

  /**
   * Creates/extends one `_versions_<slug>` table additively. Adding its unique
   * `(documentId, versionNumber)` index fails on a database that already holds duplicate version
   * identities (only the pre-062 read-then-insert race produced them): history is then reported, never
   * deleted, renumbered or merged — the operator decides (spec 062 §8, roadmap 0.7 / M03).
   */
  private async syncVersionTable(collection: CollectionDefinition): Promise<void> {
    const definition = versionOps.versionCollectionDefinition(collection.slug);
    try {
      await this.adapters.database.syncSchema([definition]);
    } catch (err) {
      let duplicates: versionOps.DuplicateVersionIdentity[];
      try {
        duplicates = await versionOps.findDuplicateVersionIdentities(
          this.adapters.database,
          definition.slug
        );
      } catch {
        throw err;
      }
      if (duplicates.length === 0) throw err;

      const examples = duplicates
        .slice(0, 5)
        .map((d) => `document "${d.documentId}" version ${d.versionNumber} (${d.rows} rows)`)
        .join('; ');
      throw new Error(
        `Cannot add the unique (documentId, versionNumber) index to "${definition.slug}": it already ` +
          `contains ${duplicates.length} duplicate version ${duplicates.length === 1 ? 'identity' : 'identities'} ` +
          `— e.g. ${examples}. They were produced by concurrent updates before ForgeCMS enforced ` +
          `version identity. ForgeCMS will not delete, renumber or merge version history automatically. ` +
          `Inspect them with: SELECT "documentId", "versionNumber", COUNT(*) FROM "${definition.slug}" ` +
          `GROUP BY "documentId", "versionNumber" HAVING COUNT(*) > 1; decide which rows to keep ` +
          `(renumber or delete the extras after taking a backup), then restart.`,
        { cause: err }
      );
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

  /**
   * The first document matching `where`, or `null` — same access/hooks/drafts/populate pipeline as
   * {@link find}, just narrowed to one result with a database-side `LIMIT 1` (spec 050 §4/§5).
   */
  findOne<TSlug extends CollectionSlug<TCollections>>(
    args: TypedFindOneArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>> | null> {
    return operations.findOne(this, args as FindOneArgs) as Promise<CollectionDocument<
      CollectionBySlug<TCollections, TSlug>
    > | null>;
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
    return operations.restoreVersion(this, args);
  }

  createVersion(args: CreateVersionArgs): Promise<Version> {
    return versionOps.createVersion(this, args);
  }

  // --- Preview ----------------------------------------------------------------------------

  /**
   * A non-persistent simulation of a permitted create/update (spec 058 §3) — merges stored data with
   * unsaved changes for an existing document, or previews a new one. Delegates to `operations.preview`,
   * which enforces the same access/field-projection policy `find`/`create`/`update` do; see that
   * function's docs for the exact semantics. `overrideAccess` defaults to `true` like every other Local
   * API method (a direct call is trusted server code).
   */
  preview<TSlug extends CollectionSlug<TCollections>>(
    args: TypedPreviewArgs<TCollections, TSlug>
  ): Promise<CollectionDocument<CollectionBySlug<TCollections, TSlug>>> {
    return operations.preview(this, args as operations.PreviewArgs) as Promise<
      CollectionDocument<CollectionBySlug<TCollections, TSlug>>
    >;
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
