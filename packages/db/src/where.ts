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

/** Normalize any WhereCondition to a single `{ operator, value }` pair (eq for bare values). */
export function toOperatorValue(condition: WhereCondition): {
  operator: WhereOperator;
  value: unknown;
} {
  if (!isWhereValue(condition)) {
    return { operator: 'eq', value: condition };
  }
  const [operator] = Object.keys(condition) as WhereOperator[];
  if (!operator) {
    return { operator: 'eq', value: condition };
  }
  return { operator, value: condition[operator] };
}

export function matchesCondition(recordValue: unknown, condition: WhereCondition): boolean {
  const { operator, value } = toOperatorValue(condition);

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
      return (
        typeof recordValue === 'string' && typeof value === 'string' && recordValue.includes(value)
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
