import { validateCollection } from '@forge-cms/core';
import type { CmsUser, CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import type { AtomicWriteOperation, DatabaseRecord } from '@forge-cms/db';
import {
  isAtomicWriteConditionError,
  isUniqueConstraintError as isDbUniqueConstraintError
} from '@forge-cms/db';
import type { OperationContext } from './context.js';
import {
  AccessDeniedError,
  ConcurrentModificationError,
  ForgeError,
  InvalidInputError,
  NotFoundError,
  ValidationFailedError
} from './errors.js';
import { documentMatches, resolveAccess } from './access.js';
import { afterStamp } from './concurrency.js';
import { applyAutoSlugs, applyFieldDefaults } from './defaults.js';
import type { AccessDecision } from './access.js';
import { statusConstraint } from './read-policy.js';
import { populateRecord } from './populate.js';
import {
  runAfterChangeHooks,
  runAfterOperationHooks,
  runAfterReadHooks,
  runBeforeChangeHooks,
  runBeforeOperationHooks,
  runBeforeValidateHooks,
  runFieldHooks
} from './hooks.js';
import { assertWritableFields, filterReadableFields, FieldAccessError } from './field-access.js';
import { screenHookOutput, screenUpdateInput } from './system-fields.js';
import {
  isLocalizedField,
  resolveLocalizedDocument,
  storeLocalizedDocument
} from './localization.js';
import {
  collectWrittenTargets,
  targetAssertions,
  verifyTargetsExist
} from './relation-lifecycle.js';

const GLOBAL_ID = 'global';

export interface GlobalBaseArgs {
  global: string;
  user?: CmsUser | null;
  overrideAccess?: boolean;
}

export interface GetGlobalArgs extends GlobalBaseArgs {
  depth?: 0 | 1;
  /** Resolve `localized` fields to this locale (with fallback), for a global declaring `locales` (spec 066). */
  locale?: string;
}

export interface UpdateGlobalArgs extends GlobalBaseArgs {
  data: Record<string, unknown>;
  /** Write `localized` fields into this locale only, keeping the others (spec 066). Must be one of the global's `locales`. */
  locale?: string;
}

/**
 * The global options that exist on the shared collection types but can never apply to a singleton that
 * is never created through `create` nor deleted (spec 066): delete hooks, and `create`/`delete` access
 * rules. Refused at startup instead of being accepted and silently ignored. One message per problem.
 * (Localized fields of globals are checked with collections', by `validateLocalizationSchema`.)
 */
export function validateGlobalSchema(globals: readonly GlobalDefinition[]): string[] {
  const errors: string[] = [];
  for (const global of globals) {
    const label = `Global '${global.slug}'`;
    for (const hook of ['beforeDelete', 'afterDelete'] as const) {
      if ((global.hooks?.[hook]?.length ?? 0) > 0) {
        errors.push(
          `${label} declares ${hook} hooks, but a global is never deleted, so they could never run (spec 066). Remove them.`
        );
      }
    }
    for (const rule of ['create', 'delete'] as const) {
      if (global.access?.[rule] !== undefined) {
        errors.push(
          `${label} declares access.${rule}, but a global only has read and update: its first write is ` +
            `an update and it is never deleted, so this rule could never apply (spec 066). Gate the ` +
            `first write with access.update.`
        );
      }
    }
  }
  return errors;
}

/** The collection-shaped view of a global the shared pipeline stages (hooks, validation, locales) take. */
function proxyOf(global: GlobalDefinition): CollectionDefinition {
  return { ...global, upload: false };
}

function assertKnownLocale(global: GlobalDefinition, locale: string | undefined): void {
  if (locale === undefined) return;
  if (!global.locales?.includes(locale)) {
    throw new InvalidInputError(
      global.locales && global.locales.length > 0
        ? `Unknown locale '${locale}' for global '${global.slug}'; expected one of ${global.locales.map((l) => `'${l}'`).join(', ')}`
        : `Global '${global.slug}' is not localized; locale '${locale}' cannot be written`
    );
  }
}

function getGlobalOrThrow(ctx: OperationContext, slug: string): GlobalDefinition {
  const global = ctx.getGlobal(slug);
  if (!global) throw new NotFoundError(`Global '${slug}' not found`);
  return global;
}

async function checkGlobalAccess(
  global: GlobalDefinition,
  operation: 'read' | 'update',
  args: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    data?: Record<string, unknown>;
    doc?: Record<string, unknown>;
  }
): Promise<AccessDecision> {
  if (args.overrideAccess !== false) return { allowed: true };

  const decision = await resolveAccess(global.access?.[operation], {
    user: args.user ?? null,
    operation,
    collection: { ...global, upload: false },
    ...(args.data !== undefined && { data: args.data }),
    ...(args.doc !== undefined && { doc: args.doc })
  });

  if (decision === undefined) return { allowed: true };
  if (!decision.allowed) throw new AccessDeniedError();
  return decision;
}

async function runRejectableStage<T>(stage: () => Promise<T>, label: string): Promise<T> {
  try {
    return await stage();
  } catch (err) {
    if (err instanceof ForgeError) throw err;
    throw new InvalidInputError(err instanceof Error ? err.message : `${label} failed`);
  }
}

async function prepareGlobalForRead(
  ctx: OperationContext,
  global: GlobalDefinition,
  record: DatabaseRecord | null,
  args: { user?: CmsUser | null; overrideAccess?: boolean; depth?: 0 | 1; locale?: string }
): Promise<DatabaseRecord | null> {
  if (!record) return null;

  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  const collectionProxy = proxyOf(global);

  let doc = record;

  if (args.depth === 1) {
    doc = await populateRecord(doc, collectionProxy, ctx, {
      user,
      ...(args.overrideAccess !== undefined && { overrideAccess: args.overrideAccess })
    });
  }

  if (args.overrideAccess === false) {
    doc = await filterReadableFields(doc, collectionProxy, user);
  }

  if (args.locale !== undefined) {
    doc = resolveLocalizedDocument(doc, collectionProxy, args.locale) as DatabaseRecord;
  }

  const withFieldHooks = await runFieldHooks(collectionProxy, 'afterRead', {
    data: doc,
    operation: 'read',
    user,
    overrideAccess
  });

  return runAfterReadHooks(collectionProxy, { user, overrideAccess, doc: withFieldHooks });
}

/**
 * Reads the singleton global document. Returns `null` if the global has never been written.
 */
export async function getGlobal(
  ctx: OperationContext,
  args: GetGlobalArgs
): Promise<DatabaseRecord | null> {
  const global = getGlobalOrThrow(ctx, args.global);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;

  await runBeforeOperationHooks(
    { ...global, upload: false },
    { operation: 'read', user, overrideAccess }
  );

  const decision = await checkGlobalAccess(global, 'read', args);

  const record = await ctx.adapters.database.findById(`_global_${global.slug}`, GLOBAL_ID);

  // Spec 066: a query-returning read rule is a row-level grant, as on a collection read. A global row
  // it does not match reads as `null` — the same answer as "never configured", confirming nothing.
  if (record && decision.where && !documentMatches(record, decision.where)) {
    await runAfterOperationHooks(proxyOf(global), {
      operation: 'read',
      user,
      overrideAccess,
      result: null
    });
    return null;
  }

  // Draft visibility (spec 058 §8): a global was previously written but never gated its own
  // `_status` on read, so an anonymous caller could read a global's unpublished draft content the
  // exact same way an anonymous single-document read of a `drafts: true` collection cannot. Mirrors
  // `findByID`'s "known id" reasoning — any authenticated caller sees a draft global, since there is
  // no listing surface for globals to leak it through; anonymous is restricted to published. A hidden
  // draft resolves to the same `null` as "never configured" rather than a distinct error, so neither
  // shape confirms whether the global has ever been written.
  const draftStatus = statusConstraint(
    { ...global, upload: false },
    undefined,
    user,
    overrideAccess,
    'all'
  );
  if (record && draftStatus && !documentMatches(record, draftStatus)) {
    await runAfterOperationHooks(
      { ...global, upload: false },
      { operation: 'read', user, overrideAccess, result: null }
    );
    return null;
  }

  if (!record) {
    await runAfterOperationHooks(
      { ...global, upload: false },
      { operation: 'read', user, overrideAccess, result: null }
    );
    return null;
  }

  const doc = await prepareGlobalForRead(ctx, global, record, args);

  await runAfterOperationHooks(
    { ...global, upload: false },
    { operation: 'read', user, overrideAccess, result: doc }
  );
  return doc;
}

/**
 * Creates or updates the singleton global document. Unlike collections, globals always have exactly one
 * document — the first write creates it, later writes update it.
 *
 * Later writes are **partial**, exactly like a collection `update()` (spec 066): omitted fields keep
 * their stored values (defaults and the draft status apply to the first write only), validation runs on
 * the merged document, and a `locale` write changes that locale of each `localized` field and keeps the
 * others. A query-returning `access.update` rule must match the stored row, and cannot authorize the
 * first write (there is no row to match). Two simultaneous first writes: one commits, the other gets
 * `409 CONCURRENT_MODIFICATION` with nothing written.
 */
export async function updateGlobal(
  ctx: OperationContext,
  args: UpdateGlobalArgs
): Promise<DatabaseRecord> {
  const global = getGlobalOrThrow(ctx, args.global);
  const user = args.user ?? null;
  const overrideAccess = args.overrideAccess !== false;
  const collectionProxy = proxyOf(global);
  assertKnownLocale(global, args.locale);

  await runBeforeOperationHooks(collectionProxy, { operation: 'update', user, overrideAccess });

  const existing = await ctx.adapters.database.findById(`_global_${global.slug}`, GLOBAL_ID);
  const operation = existing ? 'update' : 'create';

  const decision = await checkGlobalAccess(global, 'update', {
    ...args,
    ...(existing !== null && { doc: existing })
  });
  if (decision.where && !(existing && documentMatches(existing, decision.where))) {
    throw new AccessDeniedError();
  }

  // Spec 063: a global row's `id`/timestamps/`_storageKey` belong to Forge. Echoes of the stored row
  // are dropped; before the first write there is nothing to echo, so any of them is refused.
  const stored = existing ?? {};
  const input = screenUpdateInput(args.data, stored);

  if (args.overrideAccess === false) {
    try {
      await assertWritableFields(input, collectionProxy, user, operation);
    } catch (err) {
      if (err instanceof FieldAccessError) throw new AccessDeniedError(err.message);
      throw err;
    }
  }

  // A locale write merges into the stored per-locale maps, so it is derived from `existing` and must
  // commit only while the row is still the one it was merged from (compare-and-set below).
  const localized = storeLocalizedDocument(
    input,
    collectionProxy,
    args.locale,
    existing ?? undefined
  );
  const mergesLocales =
    existing !== null &&
    args.locale !== undefined &&
    Object.keys(input).some((name) => {
      const field = global.fields[name];
      return field !== undefined && isLocalizedField(field);
    });

  const seeded = existing
    ? applyAutoSlugs(collectionProxy, localized, existing)
    : applyAutoSlugs(collectionProxy, applyFieldDefaults(collectionProxy, localized));

  let data = await runRejectableStage(
    async () =>
      runBeforeValidateHooks(collectionProxy, {
        operation,
        data: await runFieldHooks(collectionProxy, 'beforeValidate', {
          data: seeded,
          ...(existing !== null && { previousData: existing }),
          operation,
          user,
          overrideAccess
        }),
        ...(existing !== null && { previousData: existing }),
        user,
        overrideAccess
      }),
    'beforeValidate hook'
  );
  data = screenHookOutput(data, stored, 'beforeValidate', `global '${global.slug}'`);

  if (global.drafts === true && !existing && data._status === undefined) {
    data = { ...data, _status: 'draft' };
  }

  if (data._status !== undefined && data._status !== 'draft' && data._status !== 'published') {
    throw new InvalidInputError(
      `Invalid status '${String(data._status)}', expected 'draft' or 'published'`
    );
  }

  if (existing) {
    // As a collection update: validate the merged document, report only what the caller can act on.
    const validation = validateCollection(collectionProxy, { ...existing, ...data });
    if (!validation.valid) {
      const relevant = validation.errors.filter((e) => {
        const top = e.field.split('.')[0] ?? e.field;
        return data[top] !== undefined || existing[top] === undefined;
      });
      if (relevant.length > 0) throw new ValidationFailedError(relevant);
    }
  } else {
    const validation = validateCollection(collectionProxy, data);
    if (!validation.valid) throw new ValidationFailedError(validation.errors);
  }

  data = await runRejectableStage(
    async () =>
      runBeforeChangeHooks(collectionProxy, {
        operation,
        data: await runFieldHooks(collectionProxy, 'beforeChange', {
          data,
          ...(existing !== null && { previousData: existing }),
          operation,
          user,
          overrideAccess
        }),
        ...(existing !== null && { previousData: existing }),
        user,
        overrideAccess
      }),
    'beforeChange hook'
  );
  data = screenHookOutput(data, stored, 'beforeChange', `global '${global.slug}'`);

  // A global's relation/upload targets must exist, now and when it commits (spec 064 §4) — a global
  // reference restricts deletion of its target, so it must never be written pointing at nothing.
  const targets = collectWrittenTargets(global.fields, data, existing ?? undefined);
  if (targets.size > 0) await verifyTargetsExist(ctx, targets);

  const record = await writeGlobal(ctx, {
    global,
    data,
    existing,
    compareAndSet: mergesLocales,
    assertions: targets.size > 0 ? targetAssertions(targets) : []
  });

  await runAfterChangeHooks(collectionProxy, {
    operation,
    data,
    ...(existing !== null && { previousData: existing }),
    result: record,
    doc: record,
    user,
    overrideAccess
  });

  const doc = await prepareGlobalForRead(ctx, global, record, args);
  const result = doc ?? record;

  await runAfterOperationHooks(collectionProxy, {
    operation: 'update',
    user,
    overrideAccess,
    result
  });
  return result;
}

/**
 * Persists a prepared global write. The first write is a `create` of the fixed `global` row: of two
 * simultaneous first writers, the row's primary key lets exactly one commit, and the other becomes a
 * `409` instead of leaking the internal table's unique-constraint error (spec 066). A write carrying
 * relation-target assertions (spec 064 §4), or a locale merge that must not overwrite a concurrent one
 * (`compareAndSet`, on `updated_at`), is one `atomicWrite`; a failed condition is a `409`, nothing written.
 */
async function writeGlobal(
  ctx: OperationContext,
  input: {
    global: GlobalDefinition;
    data: Record<string, unknown>;
    existing: DatabaseRecord | null;
    compareAndSet: boolean;
    assertions: AtomicWriteOperation[];
  }
): Promise<DatabaseRecord> {
  const { global, data, existing, assertions } = input;
  const table = `_global_${global.slug}`;
  const database = ctx.adapters.database;
  const concurrent = (message: string) =>
    new ConcurrentModificationError(global.slug, GLOBAL_ID, message);

  const write: AtomicWriteOperation = !existing
    ? { type: 'create', collection: table, data: { ...data, id: GLOBAL_ID } }
    : input.compareAndSet
      ? {
          type: 'updateIf',
          collection: table,
          id: GLOBAL_ID,
          data,
          condition: { targetMatches: { updated_at: existing.updated_at } },
          requireApplied: true
        }
      : { type: 'update', collection: table, id: GLOBAL_ID, data };

  if (input.compareAndSet && existing) await afterStamp(existing.updated_at);

  try {
    if (assertions.length === 0 && write.type === 'create') {
      return await database.create(table, write.data);
    }
    if (assertions.length === 0 && write.type === 'update') {
      return await database.update(table, GLOBAL_ID, write.data);
    }
    const results = await database.atomicWrite([...assertions, write]);
    const written = results[assertions.length];
    if (written?.type === 'create' || written?.type === 'update') return written.record;
    if (written?.type === 'updateIf' && written.applied) return written.record;
    throw new Error('atomicWrite returned no global record');
  } catch (err) {
    if (!existing && isDbUniqueConstraintError(err) && err.collection === table) {
      throw concurrent(
        `Global '${global.slug}' was first written by another request at the same time; nothing was ` +
          `written. Reload and try again.`
      );
    }
    if (isAtomicWriteConditionError(err)) {
      throw concurrent(
        `Global '${global.slug}' was changed, or a document this write references was deleted, by ` +
          `another request while it was in progress; nothing was written. Reload and try again.`
      );
    }
    throw err;
  }
}
