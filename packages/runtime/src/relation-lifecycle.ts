import type {
  AnyField,
  CollectionDefinition,
  FieldMap,
  GlobalDefinition,
  RelationFieldOptions,
  UploadFieldOptions
} from '@forge-cms/core';
import { ATOMIC_WRITE_MAX_OPERATIONS } from '@forge-cms/db';
import type { AtomicWriteOperation, DatabaseRecord, DatabaseWhere } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { isAuthManagedCollection } from './auth-managed.js';
import { InvalidInputError } from './errors.js';
import { versionsEnabled } from './versions.js';

/**
 * Relation lifecycle (spec 064): which reference shapes Forge supports, target validation for writes,
 * and the read-only planner for a delete's whole cascade / set-null / restrict graph. Nothing here writes
 * or runs a hook — `operations.ts` owns the lifecycle (prepare → one `atomicWrite` → finalize) and
 * imports this module, never the other way round.
 */

type OnDelete = NonNullable<RelationFieldOptions['onDelete']>;

/** A top-level `relation`/`upload` field — the only reference shape relation integrity supports. */
interface ReferenceField {
  fieldName: string;
  target: string;
  many: boolean;
  /** `upload` fields have no option and always behave as `restrict`. */
  onDelete: OnDelete;
  required: boolean;
}

function referenceFieldsOf(fields: FieldMap): ReferenceField[] {
  const result: ReferenceField[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.kind === 'relation') {
      const options = field.options as RelationFieldOptions;
      result.push({
        fieldName,
        target: options.collection,
        many: options.many === true,
        onDelete: options.onDelete ?? 'restrict',
        required: options.required === true
      });
    } else if (field.kind === 'upload') {
      const options = field.options as UploadFieldOptions;
      result.push({
        fieldName,
        target: options.collection,
        many: false,
        onDelete: 'restrict',
        required: options.required === true
      });
    }
  }
  return result;
}

// --- startup validation -----------------------------------------------------------------------------

function nestedFields(field: AnyField): FieldMap[] {
  switch (field.kind) {
    case 'group':
    case 'array':
      return [field.options.fields];
    case 'blocks':
      return field.options.blocks.map((block) => block.fields as FieldMap);
    default:
      return [];
  }
}

/** Every relation/upload field below a composite field, with a readable path. */
function nestedReferences(fields: FieldMap, prefix: string): string[] {
  const found: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const path = `${prefix}.${name}`;
    if (field.kind === 'relation' || field.kind === 'upload') found.push(path);
    for (const inner of nestedFields(field)) found.push(...nestedReferences(inner, path));
  }
  return found;
}

/**
 * The reference shapes relation integrity cannot enforce (spec 064 §2), found at startup so they are
 * refused instead of silently ignored. Returns one message per problem (empty = supported). Reads the
 * schema only — never persisted data.
 *
 * `isAuthManaged` answers `AuthAdapter.managesCollection` (spec 061); `onDelete: 'cascade' | 'set-null'`
 * onto such a collection could never run, because its documents are only ever deleted by the auth
 * adapter's own user lifecycle.
 */
export function validateRelationSchema(
  collections: readonly CollectionDefinition[],
  globals: readonly GlobalDefinition[] = [],
  isAuthManaged: (slug: string) => boolean = () => false
): string[] {
  const registered = new Set(collections.map((c) => c.slug));
  const errors: string[] = [];

  const owners = [
    ...collections.map((c) => ({
      label: `Collection '${c.slug}'`,
      fields: c.fields,
      global: false
    })),
    ...globals.map((g) => ({ label: `Global '${g.slug}'`, fields: g.fields, global: true }))
  ];

  for (const owner of owners) {
    for (const [name, field] of Object.entries(owner.fields)) {
      for (const inner of nestedFields(field)) {
        for (const path of nestedReferences(inner, name)) {
          errors.push(
            `${owner.label}: field '${path}' is a relation/upload inside a ${field.kind} field. ` +
              `Nested references are stored inside a JSON column that ForgeCMS cannot query, so neither ` +
              `onDelete nor target existence can be enforced (spec 064). Move it to a top-level field, ` +
              `or store the id in a text/json field as an explicit unchecked reference.`
          );
        }
      }
    }

    for (const reference of referenceFieldsOf(owner.fields)) {
      const label = `${owner.label}: field '${reference.fieldName}'`;
      const field = owner.fields[reference.fieldName];
      if (field?.options.localized === true) {
        errors.push(
          `${label} is a localized relation/upload. A localized reference stores a per-locale map that ` +
            `relation integrity and the query language cannot address (and that relation validation ` +
            `rejects), so it is not supported (spec 064). Use one non-localized reference field per locale.`
        );
        continue;
      }
      if (!registered.has(reference.target)) {
        errors.push(
          `${label} references collection '${reference.target}', which is not registered, so its ` +
            `targets can never be validated (spec 064).`
        );
        continue;
      }
      if (owner.global && reference.onDelete !== 'restrict') {
        errors.push(
          `${label} sets onDelete '${reference.onDelete}'. A global is never deleted or detached by a ` +
            `relation cascade; its references always restrict deletion of their target (spec 064).`
        );
      }
      if (reference.onDelete !== 'restrict' && isAuthManaged(reference.target)) {
        errors.push(
          `${label} sets onDelete '${reference.onDelete}' on a reference to '${reference.target}', which ` +
            `is managed by the configured auth adapter. Its documents are deleted only through the auth ` +
            `adapter's user lifecycle, which never runs relation cascades, so this option could never ` +
            `apply (spec 064).`
        );
      }
    }
  }
  return errors;
}

// --- who references a collection -------------------------------------------------------------------

/** A place a reference to `target` can live: a collection's or a global's top-level field. */
interface Referrer extends ReferenceField {
  /** The database collection the rows live in (`_global_<slug>` for a global). */
  table: string;
  /** Set for a collection referrer; a global row is never deleted or updated by a cascade. */
  collection?: CollectionDefinition;
  global?: GlobalDefinition;
}

function referrersOf(ctx: OperationContext, target: string): Referrer[] {
  const result: Referrer[] = [];
  for (const collection of ctx.getCollections()) {
    for (const reference of referenceFieldsOf(collection.fields)) {
      if (reference.target === target) {
        result.push({ ...reference, table: collection.slug, collection });
      }
    }
  }
  for (const global of ctx.getGlobals?.() ?? []) {
    for (const reference of referenceFieldsOf(global.fields)) {
      if (reference.target === target) {
        result.push({ ...reference, table: `_global_${global.slug}`, global });
      }
    }
  }
  return result;
}

/** Rows whose `referrer` field references any of `ids`. */
function referencesAny(referrer: ReferenceField, ids: readonly string[]): DatabaseWhere {
  if (referrer.many) {
    return { or: ids.map((id) => ({ [referrer.fieldName]: { containsValue: id } })) };
  }
  return { [referrer.fieldName]: { in: [...ids] } };
}

/**
 * "No row references any of `ids` in `target` any more" — one `assertCount(…, 0)` per referring field of
 * a collection or global. The single definition of the final-state reference guard, shared by a content
 * delete's plan and by the guard an auth adapter commits with its own user delete (spec 065).
 */
export function noReferenceAssertions(
  ctx: OperationContext,
  target: string,
  ids: readonly string[]
): AtomicWriteOperation[] {
  return referrersOf(ctx, target).map((referrer) => ({
    type: 'assertCount',
    collection: referrer.table,
    where: referencesAny(referrer, ids),
    equals: 0
  }));
}

/** Whether any supported relation/upload field of a collection or global references `target`. */
export function isReferenced(ctx: OperationContext, target: string): boolean {
  return referrersOf(ctx, target).length > 0;
}

// --- target validation for writes (spec 064 §4) -----------------------------------------------------

/** Target collection → the unique ids a write references there, plus the fields that wrote them. */
export type WrittenTargets = Map<string, { ids: Set<string>; fields: Set<string> }>;

/**
 * The relation targets a write introduces. On update (`existing` given) only values that change count:
 * a single reference different from the stored one, and for `many` only ids not already stored — so a
 * partial update that leaves a (possibly historically orphaned) reference alone validates nothing.
 */
export function collectWrittenTargets(
  fields: FieldMap,
  data: Record<string, unknown>,
  existing?: Record<string, unknown>
): WrittenTargets {
  const targets: WrittenTargets = new Map();
  const add = (target: string, field: string, id: string) => {
    let entry = targets.get(target);
    if (!entry) {
      entry = { ids: new Set(), fields: new Set() };
      targets.set(target, entry);
    }
    entry.ids.add(id);
    entry.fields.add(field);
  };

  for (const reference of referenceFieldsOf(fields)) {
    if (!Object.hasOwn(data, reference.fieldName)) continue;
    const value = data[reference.fieldName];
    const stored = existing?.[reference.fieldName];
    if (reference.many) {
      if (!Array.isArray(value)) continue;
      const kept = new Set(Array.isArray(stored) ? stored : []);
      for (const id of value) {
        if (typeof id === 'string' && !kept.has(id)) add(reference.target, reference.fieldName, id);
      }
    } else if (typeof value === 'string' && value !== stored) {
      add(reference.target, reference.fieldName, value);
    }
  }
  return targets;
}

/**
 * The references an update **re-sends unchanged** (spec 064 §4): single values equal to the stored one,
 * and ids of a `many` value already stored. They are not target-checked (a historical orphan must stay
 * saveable), so instead the write only commits while the row **still holds them**. Otherwise a relation
 * delete that cleared them after this update read the row (set-null) would be silently undone, leaving a
 * reference to the deleted document. `undefined` when nothing is re-sent.
 */
export function echoedReferenceGuard(
  fields: FieldMap,
  data: Record<string, unknown>,
  existing: Record<string, unknown>
): DatabaseWhere | undefined {
  const clauses: DatabaseWhere[] = [];
  for (const reference of referenceFieldsOf(fields)) {
    if (!Object.hasOwn(data, reference.fieldName)) continue;
    const value = data[reference.fieldName];
    const stored = existing[reference.fieldName];
    if (reference.many) {
      if (!Array.isArray(value) || !Array.isArray(stored)) continue;
      const kept = new Set(stored);
      for (const id of new Set(value)) {
        if (typeof id === 'string' && kept.has(id)) {
          clauses.push({ [reference.fieldName]: { containsValue: id } });
        }
      }
    } else if (typeof value === 'string' && value === stored) {
      clauses.push({ [reference.fieldName]: value });
    }
  }
  return clauses.length > 0 ? { and: clauses } : undefined;
}

/**
 * The deterministic answer for a write naming a target that does not exist: one `count` per target
 * collection (an `in` over the unique ids, not a read per id), then a `400` naming the field and the
 * missing ids. This is the only place "missing" is reported as bad input — a target that disappears
 * after this read fails the write's own `assertCount` instead (a `409`, see {@link targetAssertions}).
 */
export async function verifyTargetsExist(
  ctx: OperationContext,
  targets: WrittenTargets
): Promise<void> {
  for (const [target, { ids, fields }] of targets) {
    const missing: string[] = [];
    for (const list of chunks([...ids])) {
      const found = await ctx.adapters.database.count(target, { id: { in: list } });
      if (found === list.length) continue;
      const present = new Set(
        (
          await ctx.adapters.database.findMany({ collection: target, where: { id: { in: list } } })
        ).map((row) => row.id)
      );
      missing.push(...list.filter((id) => !present.has(id)));
    }
    if (missing.length === 0) continue;
    throw new InvalidInputError(
      `Field ${[...fields].map((f) => `'${f}'`).join(', ')} references ${missing.length === 1 ? 'a document' : 'documents'} ` +
        `that ${missing.length === 1 ? 'does' : 'do'} not exist in '${target}': ${missing.map((id) => `'${id}'`).join(', ')}`
    );
  }
}

/**
 * Ids per `in` list. D1 allows 100 bound parameters per statement and an `assertCount` also binds
 * `equals`, so a larger id set is checked in several statements instead of failing with a raw driver
 * error.
 */
const IDS_PER_STATEMENT = 90;

function chunks(ids: string[]): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_STATEMENT) {
    result.push(ids.slice(i, i + IDS_PER_STATEMENT));
  }
  return result;
}

/**
 * `assertCount`s proving every written target still exists when the write commits: one per target
 * collection, or one per 90 ids of a very large `many` write (each counts against the batch cap).
 */
export function targetAssertions(targets: WrittenTargets): AtomicWriteOperation[] {
  return [...targets].flatMap(([target, { ids }]) =>
    chunks([...ids]).map(
      (list): AtomicWriteOperation => ({
        type: 'assertCount',
        collection: target,
        where: { id: { in: list } },
        equals: list.length
      })
    )
  );
}

// --- delete planning (spec 064 §5) ------------------------------------------------------------------

export interface PlannedDelete {
  collection: CollectionDefinition;
  /** The document as read while planning; its `updated_at` guards the batch and its `_storageKey` is cleaned up. */
  doc: DatabaseRecord;
}

export interface PlannedSetNull {
  collection: CollectionDefinition;
  id: string;
  /** Field → the deleted ids to clear from it (single → `null`, many → removed from the array). */
  removals: Map<string, { many: boolean; ids: Set<string> }>;
}

export interface RelationDeletePlan {
  /** Root first, then dependents in discovery order. */
  deletes: PlannedDelete[];
  setNulls: PlannedSetNull[];
  /** "No surviving row references a deleted document", checked last in the batch (final state). */
  assertions: AtomicWriteOperation[];
}

const MAX = ATOMIC_WRITE_MAX_OPERATIONS;

function tooLarge(root: { slug: string; id: string }): InvalidInputError {
  return new InvalidInputError(
    `Cannot delete document '${root.id}' from '${root.slug}': together with its cascade deletes, ` +
      `set-null updates, version snapshots and reference checks it needs more than ${MAX} database ` +
      `operations, the most ForgeCMS commits atomically in one operation. Nothing was changed. Delete or ` +
      `detach the dependent documents in smaller steps first.`
  );
}

function keyOf(slug: string, id: string): string {
  return `${slug}:${id}`;
}

/**
 * Plans a delete's complete relation consequences **with reads only** — nothing is written and no hook
 * runs here. Breadth-first over `collection:id` keys, each scheduled at most once, so self references,
 * cycles and diamonds terminate. Every referencing-row query is bounded (`limit: MAX + 1`): a plan that
 * could not fit in one batch is refused, never truncated or chunked.
 *
 * Restrict and required set-null are judged against the **final** state: a reference only blocks the
 * delete if the document holding it survives (a restrict referrer that is itself cascade-deleted in the
 * same plan does not block). Throws `InvalidInputError` for a blocking restrict, a surviving required
 * set-null, a cascade/set-null into an auth-managed collection (spec 061), or an oversized plan.
 */
export async function planRelationDelete(
  ctx: OperationContext,
  root: { collection: CollectionDefinition; doc: DatabaseRecord }
): Promise<RelationDeletePlan> {
  const rootId = root.doc.id as string;
  const rootRef = { slug: root.collection.slug, id: rootId };
  const deletes = new Map<string, PlannedDelete>();
  const deletedIds = new Map<string, Set<string>>();
  const queue: PlannedDelete[] = [];
  const schedule = (planned: PlannedDelete) => {
    const id = planned.doc.id as string;
    deletes.set(keyOf(planned.collection.slug, id), planned);
    let ids = deletedIds.get(planned.collection.slug);
    if (!ids) deletedIds.set(planned.collection.slug, (ids = new Set()));
    ids.add(id);
    queue.push(planned);
    if (deletes.size > MAX) throw tooLarge(rootRef);
  };

  const restrictions: {
    node: { slug: string; id: string };
    referrer: Referrer;
    keys: string[];
    overflow: boolean;
  }[] = [];
  const setNullEdges = new Map<
    string,
    { referrer: Referrer; collection: CollectionDefinition; id: string; node: string }[]
  >();

  schedule(root);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const node = { slug: next.collection.slug, id: next.doc.id as string };

    for (const referrer of referrersOf(ctx, node.slug)) {
      const rows = await ctx.adapters.database.findMany({
        collection: referrer.table,
        where: referencesAny(referrer, [node.id]),
        limit: MAX + 1
      });
      if (rows.length === 0) continue;

      const { collection } = referrer;
      if (!collection) {
        // A global is never deleted: its reference always blocks.
        throw new InvalidInputError(
          `Cannot delete document '${node.id}' from '${node.slug}': referenced by global ` +
            `'${referrer.global?.slug ?? referrer.table}' (field '${referrer.fieldName}')`
        );
      }

      if (referrer.onDelete !== 'restrict' && isAuthManagedCollection(ctx, collection.slug)) {
        throw new InvalidInputError(
          `Cannot delete document '${node.id}' from '${node.slug}': ` +
            `${rows.length} document(s) in '${collection.slug}' reference it with ` +
            `onDelete '${referrer.onDelete}', but '${collection.slug}' is managed by the configured auth adapter, ` +
            `so a relation cascade cannot change it. Clearing the reference on those document(s) is not ` +
            `possible through generic collection CRUD or the auth adapter's user-management operations; ` +
            `it requires direct database access, which is outside runtime guarantees`
        );
      }

      if (referrer.onDelete === 'cascade') {
        for (const row of rows) {
          if (!deletes.has(keyOf(collection.slug, row.id as string))) {
            schedule({ collection, doc: row });
          }
        }
      } else if (referrer.onDelete === 'set-null') {
        for (const row of rows) {
          const key = keyOf(collection.slug, row.id as string);
          const edges = setNullEdges.get(key) ?? [];
          edges.push({ referrer, collection, id: row.id as string, node: node.id });
          setNullEdges.set(key, edges);
        }
        if (setNullEdges.size > MAX) throw tooLarge(rootRef);
      } else {
        restrictions.push({
          node,
          referrer,
          keys: rows.map((row) => keyOf(collection.slug, row.id as string)),
          overflow: rows.length > MAX
        });
      }
    }
  }

  // Final-state evaluation: only a surviving document's reference can block or need clearing.
  for (const { node, referrer, keys, overflow } of restrictions) {
    const surviving = keys.filter((key) => !deletes.has(key));
    if (overflow || surviving.length > 0) {
      throw new InvalidInputError(
        `Cannot delete document '${node.id}' from '${node.slug}': ` +
          `referenced by ${overflow ? `more than ${MAX}` : surviving.length} document(s) in '${referrer.table}'`
      );
    }
  }

  const setNulls: PlannedSetNull[] = [];
  for (const [key, edges] of setNullEdges) {
    if (deletes.has(key)) continue;
    const first = edges[0];
    if (!first) continue;
    const removals: PlannedSetNull['removals'] = new Map();
    for (const { referrer, node } of edges) {
      if (referrer.required) {
        throw new InvalidInputError(
          `Cannot delete document '${node}' from '${referrer.target}': field '${referrer.fieldName}' ` +
            `on '${first.collection.slug}' is required and configured 'onDelete: set-null', which cannot ` +
            `satisfy the referencing document(s) without violating that requirement`
        );
      }
      const entry = removals.get(referrer.fieldName) ?? {
        many: referrer.many,
        ids: new Set<string>()
      };
      entry.ids.add(node);
      removals.set(referrer.fieldName, entry);
    }
    setNulls.push({ collection: first.collection, id: first.id, removals });
  }

  const assertions = [...deletedIds].flatMap(([target, ids]) =>
    noReferenceAssertions(ctx, target, [...ids])
  );

  const operations =
    deletes.size +
    setNulls.reduce((sum, s) => sum + (versionsEnabled(s.collection) ? 2 : 1), 0) +
    assertions.length;
  if (operations > MAX) throw tooLarge(rootRef);

  return { deletes: [...deletes.values()], setNulls, assertions };
}

/**
 * The set-null patch for `doc` as it is now: single references to a deleted id become `null`, deleted
 * ids are removed from `many` arrays. `null` when the document no longer references any of them (it
 * changed since planning) — then there is nothing to write.
 */
export function setNullPatch(
  planned: PlannedSetNull,
  doc: DatabaseRecord
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const [field, { many, ids }] of planned.removals) {
    const value = doc[field];
    if (many) {
      if (Array.isArray(value) && value.some((id) => ids.has(id as string))) {
        patch[field] = value.filter((id) => !ids.has(id as string));
      }
    } else if (typeof value === 'string' && ids.has(value)) {
      patch[field] = null;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
