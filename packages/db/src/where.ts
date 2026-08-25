export type WhereOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface WhereValue {
  eq?: unknown;
  ne?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: unknown[];
  contains?: string;
}

/** A bare value means `eq` (backward compatible with `{ field: value }` usage). */
export type WhereCondition = unknown | WhereValue;

export type DatabaseWhere = Record<string, WhereCondition>;

const WHERE_OPERATORS: readonly WhereOperator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains'
];

export function isWhereValue(condition: WhereCondition): condition is WhereValue {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) {
    return false;
  }
  const keys = Object.keys(condition);
  return keys.length > 0 && keys.every((key) => (WHERE_OPERATORS as string[]).includes(key));
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
