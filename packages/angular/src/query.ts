/**
 * Query options for a list request, mirroring what the HTTP layer parses (specs 011, 012, 017, 018).
 *
 * Before spec 041 none of this was reachable from the client: `getDocuments(collection)` took no
 * arguments, so every app that needed a filter, an order or a page fell back to raw `fetch`.
 */
export interface QueryOptions {
  /**
   * Field filters. A bare value means equality; an object names an operator:
   * `{ featured: true, price: { gte: 50 }, id: { in: ['a', 'b'] } }`.
   */
  where?: Record<string, unknown>;
  /** Field to sort by. Single-field only, as the API is today. */
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /** 1-based page number. Converted to `offset` when `limit` is set; ignored otherwise. */
  page?: number;
  /** `1` replaces relation and upload ids with the referenced document. */
  depth?: 0 | 1;
  /** Draft visibility on a `drafts: true` collection. Requires authentication for anything but `published`. */
  status?: 'draft' | 'published' | 'all';
}

const RESERVED = new Set(['limit', 'offset', 'sort', 'order', 'depth', 'status']);

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

  if (options.sort !== undefined) params.set('sort', options.sort);
  if (options.order !== undefined) params.set('order', options.order);
  if (options.depth !== undefined) params.set('depth', String(options.depth));
  if (options.status !== undefined) params.set('status', options.status);
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const offset =
    options.offset ??
    (options.page !== undefined && options.limit !== undefined
      ? Math.max(0, options.page - 1) * options.limit
      : undefined);
  if (offset !== undefined) params.set('offset', String(offset));

  for (const [field, condition] of Object.entries(options.where ?? {})) {
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

  const query = params.toString();
  return query ? `?${query}` : '';
}
