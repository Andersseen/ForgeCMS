/**
 * Query primitives mirroring `@forge-cms/db`'s `DatabaseWhere`/`SortInput` (spec 011, spec 050) —
 * duck-typed rather than imported, since this package has zero workspace dependencies (browser-side,
 * talks HTTP JSON only).
 */
export type WhereCondition = unknown | Record<string, unknown>;
export type WhereFields = Record<string, WhereCondition>;
export interface WhereAndGroup {
  and: QueryWhere[];
}
export interface WhereOrGroup {
  or: QueryWhere[];
}
/** `and`/`or` are reserved top-level keys: a flat filter object can never legally use them as fields. */
export type QueryWhere = WhereFields | WhereAndGroup | WhereOrGroup;

export interface SortField {
  field: string;
  order?: 'asc' | 'desc';
}
/** A single field name keeps the pre-spec-050 meaning; an array is a multi-field sort. */
export type SortInput = string | SortField[];

function isWhereGroup(where: QueryWhere): where is WhereAndGroup | WhereOrGroup {
  return (
    typeof where === 'object' &&
    where !== null &&
    (('and' in where && Array.isArray((where as WhereAndGroup).and)) ||
      ('or' in where && Array.isArray((where as WhereOrGroup).or)))
  );
}

/**
 * Query options for a list request, mirroring what the HTTP layer parses (specs 011, 012, 017, 018,
 * 050).
 *
 * Before spec 041 none of this was reachable from the client: `getDocuments(collection)` took no
 * arguments, so every app that needed a filter, an order or a page fell back to raw `fetch`.
 */
export interface QueryOptions {
  /**
   * Field filters. A bare value means equality; an object names an operator:
   * `{ featured: true, price: { gte: 50 }, id: { in: ['a', 'b'] } }`. Nested `and`/`or` groups
   * (spec 050) compose recursively, e.g. `{ and: [{ status: 'published' }, { or: [...] }] }`.
   */
  where?: QueryWhere;
  /** Field to sort by, or a multi-field sort list (spec 050): `[{ field: 'featured', order: 'desc' }, ...]`. */
  sort?: SortInput;
  /** Only meaningful when `sort` is a plain field name; a multi-field `sort` carries its own per-field order. */
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /** 1-based page number. Converted to `offset` when `limit` is set; ignored otherwise. */
  page?: number;
  /** `1` replaces relation and upload ids with the referenced document. */
  depth?: 0 | 1;
  /** Draft visibility on a `drafts: true` collection. Requires authentication for anything but `published`. */
  status?: 'draft' | 'published' | 'all';
  /** Locale to resolve localized fields to on read, or to write on create/update. */
  locale?: string;
}

const RESERVED = new Set([
  'limit',
  'offset',
  'sort',
  'order',
  'depth',
  'status',
  'locale',
  'where'
]);

function serialiseValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(',');
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Turns {@link QueryOptions} into the query string the API expects — exported because anything that
 * builds links (a paginator writing `?page=2`, a filter chip) must produce exactly the same strings.
 */
export function buildQueryString(options?: QueryOptions): string {
  if (!options) return '';
  const params = new URLSearchParams();

  // `sort` first, matching the pre-spec-050 insertion order exactly — buildQueryString's whole
  // purpose is producing byte-identical strings for existing callers (link builders, cache keys),
  // and URLSearchParams.toString() preserves insertion order.
  if (options.sort !== undefined) {
    params.set('sort', Array.isArray(options.sort) ? JSON.stringify(options.sort) : options.sort);
  }
  if (options.order !== undefined) params.set('order', options.order);
  if (options.depth !== undefined) params.set('depth', String(options.depth));
  if (options.status !== undefined) params.set('status', options.status);
  if (options.locale !== undefined) params.set('locale', options.locale);
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const offset =
    options.offset ??
    (options.page !== undefined && options.limit !== undefined
      ? Math.max(0, options.page - 1) * options.limit
      : undefined);
  if (offset !== undefined) params.set('offset', String(offset));

  if (options.where !== undefined) {
    if (isWhereGroup(options.where)) {
      params.set('where', JSON.stringify(options.where));
    } else {
      for (const [field, condition] of Object.entries(options.where)) {
        if (condition === undefined) continue;
        // A reserved name as a filter would be read as a pagination parameter by the server.
        if (RESERVED.has(field)) continue;

        if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
          for (const [operator, value] of Object.entries(condition as Record<string, unknown>)) {
            if (value === undefined) continue;
            params.set(`${field}[${operator}]`, serialiseValue(value));
          }
          continue;
        }

        params.set(field, serialiseValue(condition));
      }
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}
