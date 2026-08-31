import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseWhere, SortInput } from '@forge-cms/db';
import { WHERE_OPERATORS, normalizeSort } from '@forge-cms/db';
import { InvalidQueryError, UnknownFieldError } from './errors.js';

const DEFAULT_MAX_DEPTH = 6;
const KNOWN_OPERATORS = new Set<string>(WHERE_OPERATORS);

/** `id`/`created_at`/`updated_at` always exist; `_status` only on a `drafts: true` collection. */
function queryableSystemFields(collection: CollectionDefinition): Set<string> {
  const fields = new Set(['id', 'created_at', 'updated_at']);
  if (collection.drafts === true) fields.add('_status');
  return fields;
}

function assertKnownField(
  collection: CollectionDefinition,
  systemFields: Set<string>,
  key: string
): void {
  if (systemFields.has(key) || collection.fields[key]) return;
  throw new UnknownFieldError(`Unknown filter field '${key}' for collection '${collection.slug}'`);
}

/**
 * Validates one field's condition. `toOperatorValues` (the executor) treats a plain object as an
 * "operator object" only if *every* key is a recognized operator name; otherwise it silently falls
 * back to comparing the whole object as a bare `eq` value — the intended, pre-existing behavior for
 * exact-match filtering on a `json`-typed field (`where: { metadata: { source: 'x' } }`). That
 * fallback must stay legal here too, so this only rejects the *ambiguous* case: an object with at
 * least one recognized operator key mixed with at least one unrecognized one
 * (`{ eq: 'a', contians: 'x' }`, an operator typo) — almost certainly a mistake, not a deliberate
 * literal-object comparison, since a real `json` value comparison has no reason to also carry a real
 * operator name as a sibling key. An object where *no* key is a recognized operator name is left
 * alone entirely.
 */
function assertValidCondition(
  collection: CollectionDefinition,
  key: string,
  condition: unknown
): void {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return;

  const keys = Object.keys(condition);
  const knownKeys = keys.filter((k) => KNOWN_OPERATORS.has(k));
  const unknownKeys = keys.filter((k) => !KNOWN_OPERATORS.has(k));

  if (unknownKeys.length > 0) {
    if (knownKeys.length === 0) return; // no key looks like an operator — a bare object value
    throw new InvalidQueryError(`Unknown operator '${unknownKeys[0]}' for field '${key}'`);
  }

  if (keys.includes('containsValue') && collection.fields[key]?.kind !== 'relation') {
    throw new InvalidQueryError(
      `The 'containsValue' operator is only valid on relation fields, not '${key}'`
    );
  }
}

/**
 * Validates a `DatabaseWhere` (flat or nested `and`/`or`) against a collection's real fields before it
 * ever reaches an adapter — the single gate shared by `find`/`count`/`findOne` (spec 050 §4). Every
 * adapter also validates column names defensively, but throws a bare `Error`; this is what lets that
 * layer stay unreachable for a normal request and gives callers a stable `ForgeError` (400) instead.
 */
export function validateWhere(
  collection: CollectionDefinition,
  where: DatabaseWhere | undefined,
  opts: { maxDepth?: number } = {}
): void {
  if (!where) return;
  const systemFields = queryableSystemFields(collection);
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  validateNode(collection, systemFields, where, maxDepth, 0);
}

/**
 * Every key in a where node is validated, whatever it means — a flat field condition, or (for the
 * reserved `and`/`or` keys) a nested group — mirroring `matchesWhere`'s "every key is AND-ed
 * together" evaluation semantics (spec 050 hardening), so `and`/`or` can legally sit alongside flat
 * keys in the same object instead of one silently winning while the other goes unvalidated.
 */
function validateNode(
  collection: CollectionDefinition,
  systemFields: Set<string>,
  where: DatabaseWhere,
  maxDepth: number,
  depth: number
): void {
  if (depth > maxDepth) {
    throw new InvalidQueryError(`Query nesting exceeds the maximum depth of ${maxDepth}`);
  }
  if (typeof where !== 'object' || where === null || Array.isArray(where)) {
    throw new InvalidQueryError('Invalid query structure');
  }

  for (const [key, value] of Object.entries(where)) {
    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new InvalidQueryError(`"${key}" must be a non-empty array of query conditions`);
      }
      for (const child of value) {
        if (typeof child !== 'object' || child === null || Array.isArray(child)) {
          throw new InvalidQueryError(`Invalid query condition inside "${key}"`);
        }
        validateNode(collection, systemFields, child as DatabaseWhere, maxDepth, depth + 1);
      }
      continue;
    }

    assertKnownField(collection, systemFields, key);
    assertValidCondition(collection, key, value);
  }
}

/** Validates every field named in a `sort` (single field or multi-field) against the collection. */
export function validateSort(collection: CollectionDefinition, sort: SortInput | undefined): void {
  if (sort === undefined) return;
  const systemFields = queryableSystemFields(collection);
  const fields = normalizeSort(sort);
  if (fields.length === 0) {
    throw new InvalidQueryError('"sort" must name at least one field');
  }
  for (const entry of fields) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new InvalidQueryError('Invalid sort entry, expected { field, order? }');
    }
    const { field, order } = entry;
    if (typeof field !== 'string' || field.length === 0) {
      throw new InvalidQueryError('Invalid sort field');
    }
    assertKnownField(collection, systemFields, field);
    if (order !== undefined && order !== 'asc' && order !== 'desc') {
      throw new InvalidQueryError(
        `Invalid sort order '${String(order)}', expected 'asc' or 'desc'`
      );
    }
  }
}
