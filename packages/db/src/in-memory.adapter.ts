import type { CollectionDefinition } from '@forge-cms/core';
import type {
  AtomicWriteOperation,
  AtomicWriteResult,
  ConditionalDeleteResult,
  ConditionalUpdateResult,
  DatabaseAdapter,
  FindManyOptions,
  WriteCondition
} from './index.js';
import type { DatabaseWhere, SortInput } from './where.js';
import { matchesWhere, normalizeSort } from './where.js';
import type { ResolvedIndex } from './schema-generator.js';
import { resolveCollectionIndexes } from './schema-generator.js';
import { UniqueConstraintError } from './constraint-error.js';
import { assertValidWriteCondition } from './write-condition.js';
import {
  AtomicWriteConditionError,
  assertValidAtomicWrite,
  atomicWriteMustApply
} from './atomic-write.js';

/**
 * Whether two field values should be considered equal for unique-index purposes. Primitives compare
 * by `===`; anything else (composite JSON values) falls back to structural equality, mirroring how
 * `@forge-cms/db`'s SQLite-backed adapters would compare their serialized `TEXT` representation.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Finds a unique index the candidate record would violate against `records`, or `undefined` if none.
 * Matches SQLite's unique-index semantics: a row with `null`/`undefined` in any of an index's fields
 * can never violate that index (NULL is never equal to NULL), and `excludeId` lets `update` ignore the
 * record being updated when checking against itself.
 */
function findUniqueConflict(
  records: Record<string, unknown>[],
  candidate: Record<string, unknown>,
  excludeId: string | undefined,
  indexes: ResolvedIndex[]
): ResolvedIndex | undefined {
  for (const index of indexes) {
    if (!index.unique) continue;
    if (index.fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;

    const conflicts = records.some(
      (r) => r.id !== excludeId && index.fields.every((f) => valuesEqual(r[f], candidate[f]))
    );
    if (conflicts) return index;
  }
  return undefined;
}

/**
 * Whether a conditional write's `condition` holds for `target` given every row of its collection
 * (spec 059). The same semantics the SQL adapters compile to one statement — `matchesWhere` is the
 * executable reference for the `where` parts, and `keepAtLeast` counts rows other than the target only
 * when the target itself is currently in the set.
 */
function conditionHolds(
  records: Record<string, unknown>[],
  target: Record<string, unknown>,
  condition: WriteCondition
): boolean {
  if (condition.targetMatches && !matchesWhere(target, condition.targetMatches)) return false;

  const floor = condition.keepAtLeast;
  if (floor && matchesWhere(target, floor.where)) {
    const others = records.filter((r) => r.id !== target.id && matchesWhere(r, floor.where)).length;
    if (others < floor.others) return false;
  }
  return true;
}

/** Multi-field stable sort: the first field decides, ties fall through to the next — matches SQL `ORDER BY a, b`. */
function sortRecords(
  records: Record<string, unknown>[],
  sort: SortInput,
  legacyOrder: 'asc' | 'desc' | undefined
): Record<string, unknown>[] {
  const fields = normalizeSort(sort, legacyOrder);
  if (fields.length === 0) return records;

  return [...records].sort((a, b) => {
    for (const { field, order } of fields) {
      const direction = order === 'desc' ? -1 : 1;
      const aValue = a[field];
      const bValue = b[field];
      if (aValue === bValue) continue;
      if (aValue === undefined || aValue === null) return 1;
      if (bValue === undefined || bValue === null) return -1;
      return ((aValue as string | number) < (bValue as string | number) ? -1 : 1) * direction;
    }
    return 0;
  });
}

export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly name = 'in-memory';
  private store: Map<string, Record<string, unknown>[]> = new Map();
  private collections: Map<string, CollectionDefinition> = new Map();

  init(): this {
    return this;
  }

  private assertNoUniqueConflict(
    collection: string,
    records: Record<string, unknown>[],
    candidate: Record<string, unknown>,
    excludeId: string | undefined
  ): void {
    const collectionDef = this.collections.get(collection);
    if (!collectionDef) return;

    const uniqueIndexes = resolveCollectionIndexes(collectionDef).filter((i) => i.unique);
    if (uniqueIndexes.length === 0) return;

    const conflict = findUniqueConflict(records, candidate, excludeId, uniqueIndexes);
    if (conflict) throw new UniqueConstraintError(collection, conflict.fields, conflict.name);
  }

  async findById(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const records = this.store.get(collection) ?? [];
    return records.find((r) => r.id === id) ?? null;
  }

  async findMany(options: FindManyOptions): Promise<Record<string, unknown>[]> {
    let records = this.store.get(options.collection) ?? [];
    if (options.where) {
      const where = options.where;
      records = records.filter((r) => matchesWhere(r, where));
    }
    if (options.sort) {
      records = sortRecords(records, options.sort, options.order);
    }
    if (options.offset) {
      records = records.slice(options.offset);
    }
    if (options.limit) {
      records = records.slice(0, options.limit);
    }
    return records;
  }

  /**
   * The single-row write helpers below take the row array to work on, so the one-call methods (which pass
   * the live store array) and `atomicWrite` (which passes a staged copy) run literally the same code.
   * They are synchronous on purpose: with no `await` between deciding and writing, nothing else on this
   * instance can interleave.
   */
  private createIn(
    records: Record<string, unknown>[],
    collection: string,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    // Timestamps match LibSqlDatabaseAdapter and D1DatabaseAdapter. Without them a document created
    // in local development had no `created_at` while the same write in production did, so
    // "newest first" silently returned insertion order locally.
    const now = new Date().toISOString();
    const recordWithId = {
      ...data,
      id: data.id ?? crypto.randomUUID(),
      created_at: data.created_at ?? now,
      updated_at: now
    };
    this.assertNoUniqueConflict(collection, records, recordWithId, undefined);
    records.push(recordWithId);
    return recordWithId;
  }

  /** `undefined` when the row does not exist. `id` is never writable, matching the SQL adapters. */
  private updateIn(
    records: Record<string, unknown>[],
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Record<string, unknown> | undefined {
    const index = records.findIndex((r) => r.id === id);
    const current = records[index];
    if (!current) return undefined;

    const changes = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'id'));
    const merged = { ...current, ...changes, updated_at: new Date().toISOString() };
    this.assertNoUniqueConflict(collection, records, merged, id);
    records[index] = merged;
    return merged;
  }

  /**
   * The condition is checked *before* the unique index, so a refused write reports `applied: false`
   * rather than a constraint error — the same order SQL gives, where constraints are only enforced for a
   * row the statement actually writes.
   */
  private updateIfIn(
    records: Record<string, unknown>[],
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>,
    condition: WriteCondition
  ): ConditionalUpdateResult {
    const current = records.find((r) => r.id === id);
    if (!current || !conditionHolds(records, current, condition)) return { applied: false };
    const record = this.updateIn(records, collection, id, data);
    return record ? { applied: true, record } : { applied: false };
  }

  /** Returns the remaining rows (a new array, as `delete` always did) and whether a row was removed. */
  private deleteIn(
    records: Record<string, unknown>[],
    id: string
  ): { records: Record<string, unknown>[]; deleted: boolean } {
    const remaining = records.filter((r) => r.id !== id);
    return { records: remaining, deleted: remaining.length !== records.length };
  }

  async create(
    collection: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const records = this.store.get(collection) ?? [];
    const created = this.createIn(records, collection, data);
    this.store.set(collection, records);
    return created;
  }

  async update(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const records = this.store.get(collection) ?? [];
    const updated = this.updateIn(records, collection, id, data);
    if (!updated) throw new Error(`Record ${id} not found in ${collection}`);
    this.store.set(collection, records);
    return updated;
  }

  async count(collection: string, where?: DatabaseWhere): Promise<number> {
    const records = this.store.get(collection) ?? [];
    if (!where) return records.length;
    return records.filter((r) => matchesWhere(r, where)).length;
  }

  async delete(collection: string, id: string): Promise<void> {
    this.store.set(collection, this.deleteIn(this.store.get(collection) ?? [], id).records);
  }

  /**
   * Check and write happen in one synchronous turn — there is no `await` between evaluating the
   * condition and mutating the store — so no other call on this instance can interleave. That is the
   * whole atomicity guarantee here: it holds inside one adapter instance/process only, which is all an
   * in-process development/test adapter can offer.
   */
  async updateIf(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult> {
    assertValidWriteCondition(condition);
    const records = this.store.get(collection) ?? [];
    const result = this.updateIfIn(records, collection, id, data, condition);
    if (result.applied) this.store.set(collection, records);
    return result;
  }

  async deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult> {
    assertValidWriteCondition(condition);
    const records = this.store.get(collection) ?? [];
    const current = records.find((r) => r.id === id);
    if (!current || !conditionHolds(records, current, condition)) return { applied: false };

    this.store.set(collection, this.deleteIn(records, id).records);
    return { applied: true };
  }

  /**
   * Staging, not compensation: every operation runs against a *copy* of the rows of the collections it
   * touches, and the copies replace the live rows in one step only if every operation succeeded. Any
   * throw — a unique conflict, a `requireApplied` that did not apply, a missing `update` target — leaves
   * the store untouched, so a half-applied batch is never observable. There is no `await` between
   * staging and publishing, so this is atomic against every other call on this adapter instance; like
   * every InMemory guarantee it stops at the process boundary (spec 060).
   */
  async atomicWrite(operations: readonly AtomicWriteOperation[]): Promise<AtomicWriteResult[]> {
    assertValidAtomicWrite(operations);
    if (operations.length === 0) return [];

    const staged = new Map<string, Record<string, unknown>[]>();
    const rowsOf = (collection: string): Record<string, unknown>[] => {
      let rows = staged.get(collection);
      if (!rows) {
        rows = [...(this.store.get(collection) ?? [])];
        staged.set(collection, rows);
      }
      return rows;
    };

    const results: AtomicWriteResult[] = [];
    for (const operation of operations) {
      const rows = rowsOf(operation.collection);
      switch (operation.type) {
        case 'create':
          results.push({
            type: 'create',
            record: this.createIn(rows, operation.collection, operation.data)
          });
          break;
        case 'update': {
          const record = this.updateIn(rows, operation.collection, operation.id, operation.data);
          if (!record) throw new AtomicWriteConditionError();
          results.push({ type: 'update', record });
          break;
        }
        case 'delete':
          staged.set(operation.collection, this.deleteIn(rows, operation.id).records);
          results.push({ type: 'delete' });
          break;
        case 'updateIf': {
          const result = this.updateIfIn(
            rows,
            operation.collection,
            operation.id,
            operation.data,
            operation.condition
          );
          if (!result.applied && atomicWriteMustApply(operation))
            throw new AtomicWriteConditionError();
          results.push({ type: 'updateIf', ...result });
          break;
        }
        case 'deleteIf': {
          const current = rows.find((r) => r.id === operation.id);
          const applied = !!current && conditionHolds(rows, current, operation.condition);
          if (!applied && atomicWriteMustApply(operation)) throw new AtomicWriteConditionError();
          if (applied) staged.set(operation.collection, this.deleteIn(rows, operation.id).records);
          results.push({ type: 'deleteIf', applied });
          break;
        }
      }
    }

    for (const [collection, rows] of staged) this.store.set(collection, rows);
    return results;
  }

  async syncSchema(collections: CollectionDefinition[]): Promise<void> {
    // No real table/index DDL to run, but the collection definitions are kept so create/update can
    // enforce the same unique-index semantics D1/libSQL would (see resolveCollectionIndexes above).
    //
    // Upserts by slug rather than clearing first: `ApiKeyAuthAdapter.syncSchema()` (and any other
    // `AuthAdapter.syncSchema()`) calls this same method again with just its own internal collection,
    // often on the very same adapter instance as the main runtime (`apiKeyDatabase: database`). A
    // clear-then-repopulate here would unregister every consumer collection the first call just
    // registered, silently disabling unique-constraint enforcement for all of them.
    for (const collection of collections) {
      this.collections.set(collection.slug, collection);
    }
  }
}
