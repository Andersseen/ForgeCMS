export type WhereOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'containsValue';

export interface WhereValue {
  eq?: unknown;
  ne?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: unknown[];
  contains?: string;
  /** Exact-element membership against a JSON array column (`relation({ many: true })`). */
  containsValue?: unknown;
}

/** A bare value means `eq` (backward compatible with `{ field: value }` usage). */
export type WhereCondition = unknown | WhereValue;

/** A flat set of field filters, implicitly AND-ed across keys (spec 011) and across operators on one key. */
export type WhereFields = Record<string, WhereCondition>;

/** All child conditions must match. */
export interface WhereAndGroup {
  and: DatabaseWhere[];
}

/** At least one child condition must match. */
export interface WhereOrGroup {
  or: DatabaseWhere[];
}

/**
 * `and`/`or` are reserved top-level keys (spec 050): a plain object carrying one of them is a boolean
 * group, not a field filter. `validateCollectionIdentifiers` (`@forge-cms/core`) rejects a field
 * literally named `and`/`or`, so a real flat filter can never collide with this.
 */
export type DatabaseWhere = WhereFields | WhereAndGroup | WhereOrGroup;

/** One sort key in a multi-field sort. */
export interface SortField {
  field: string;
  order?: 'asc' | 'desc';
}

/** A single field name keeps the pre-spec-050 single-field sort meaning; an array sorts by each field in order, ties broken by the next entry. */
export type SortInput = string | SortField[];

export function isSortFieldArray(sort: SortInput): sort is SortField[] {
  return Array.isArray(sort);
}

/** Normalizes any `SortInput` to `SortField[]`, folding in the legacy standalone `order` param. */
export function normalizeSort(sort: SortInput | undefined, order?: 'asc' | 'desc'): SortField[] {
  if (sort === undefined) return [];
  if (isSortFieldArray(sort)) return sort;
  return [{ field: sort, ...(order !== undefined && { order }) }];
}

export const WHERE_OPERATORS: readonly WhereOperator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'containsValue'
];

export function isWhereValue(condition: WhereCondition): condition is WhereValue {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) {
    return false;
  }
  const keys = Object.keys(condition);
  return keys.length > 0 && keys.every((key) => (WHERE_OPERATORS as string[]).includes(key));
}

export function isWhereAndGroup(where: DatabaseWhere): where is WhereAndGroup {
  return (
    typeof where === 'object' &&
    where !== null &&
    'and' in where &&
    Array.isArray((where as WhereAndGroup).and)
  );
}

export function isWhereOrGroup(where: DatabaseWhere): where is WhereOrGroup {
  return (
    typeof where === 'object' &&
    where !== null &&
    'or' in where &&
    Array.isArray((where as WhereOrGroup).or)
  );
}

export function isWhereGroup(where: DatabaseWhere): where is WhereAndGroup | WhereOrGroup {
  return isWhereAndGroup(where) || isWhereOrGroup(where);
}

export interface OperatorValue {
  operator: WhereOperator;
  value: unknown;
}

/** Normalize any WhereCondition to one or more predicates (eq for bare values). */
export function toOperatorValues(condition: WhereCondition): OperatorValue[] {
  if (!isWhereValue(condition)) {
    return [{ operator: 'eq', value: condition }];
  }

  const predicates = WHERE_OPERATORS.flatMap((operator) =>
    condition[operator] !== undefined ? [{ operator, value: condition[operator] }] : []
  );
  if (predicates.length === 0) {
    return [{ operator: 'eq', value: condition }];
  }
  return predicates;
}

/** Normalize any WhereCondition to its first predicate. Kept for compatibility. */
export function toOperatorValue(condition: WhereCondition): OperatorValue {
  return toOperatorValues(condition)[0]!;
}

export function matchesCondition(recordValue: unknown, condition: WhereCondition): boolean {
  return toOperatorValues(condition).every(({ operator, value }) =>
    matchesOperator(recordValue, operator, value)
  );
}

function matchesOperator(recordValue: unknown, operator: WhereOperator, value: unknown): boolean {
  switch (operator) {
    case 'eq':
      return recordValue === value;
    case 'ne':
      return recordValue !== value;
    case 'gt':
      return compare(recordValue, value) > 0;
    case 'gte':
      return compare(recordValue, value) >= 0;
    case 'lt':
      return compare(recordValue, value) < 0;
    case 'lte':
      return compare(recordValue, value) <= 0;
    case 'in':
      return Array.isArray(value) && value.includes(recordValue);
    case 'contains':
      // Case-insensitive, matching SQLite's `LIKE` (which LibSqlDatabaseAdapter and
      // D1DatabaseAdapter both compile to). It used to be case-sensitive here only, so a search box
      // wired to `contains` found "Body & wellness" in production and nothing in local development.
      return (
        typeof recordValue === 'string' &&
        typeof value === 'string' &&
        recordValue.toLowerCase().includes(value.toLowerCase())
      );
    case 'containsValue':
      // Exact-element membership, not substring matching — for a relation({ many: true }) array
      // (stored as a real JS array in-process; adapters hydrate the JSON column back into one before
      // this ever runs, see fromDbValue).
      return Array.isArray(recordValue) && recordValue.some((v) => v === value);
    default:
      return false;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    const aTime = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
    const bTime = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
    return aTime - bTime;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

/**
 * Recursively evaluates a `DatabaseWhere` (flat or nested `and`/`or`) against one record — the
 * executable semantic reference every adapter's generated SQL must agree with (spec 050).
 *
 * Every key in a `where` object is AND-ed together, whatever it means — a flat field condition, or
 * (for the reserved `and`/`or` keys) a nested group. This is what lets `and`/`or` sit alongside flat
 * keys in the same object (`{ status: 'published', or: [...] }` means `status = 'published' AND
 * (...)`) instead of one silently winning and the other being dropped. An empty `or: []` has no
 * disjunct that can be true, so it evaluates to `false` (deny-all) — the standard empty-disjunction
 * identity, and the same thing an access-rule constraint means when it legitimately narrows to "no
 * matches" (e.g. `{ or: user.tenants.map(...) }` for a user in zero tenants). An empty `and: []` has
 * no conjunct that can be false, so it evaluates to `true` (match everything) — mirrored by every
 * adapter's SQL builder, which likewise contributes no constraint for an empty `and`.
 */
export function matchesWhere(
  record: Record<string, unknown>,
  where: DatabaseWhere | undefined
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'and')
      return (value as DatabaseWhere[]).every((child) => matchesWhere(record, child));
    if (key === 'or')
      return (value as DatabaseWhere[]).some((child) => matchesWhere(record, child));
    return matchesCondition(record[key], value as WhereCondition);
  });
}
