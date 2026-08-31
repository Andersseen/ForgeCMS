import { describe, expect, it } from 'vitest';
import { buildQueryString } from './query.js';

describe('buildQueryString', () => {
  it('returns an empty string for no options', () => {
    expect(buildQueryString()).toBe('');
    expect(buildQueryString({})).toBe('');
  });

  it('serialises pagination and read options', () => {
    const query = buildQueryString({
      limit: 10,
      offset: 20,
      sort: 'order',
      order: 'asc',
      depth: 1
    });
    const params = new URLSearchParams(query);

    expect(params.get('limit')).toBe('10');
    expect(params.get('offset')).toBe('20');
    expect(params.get('sort')).toBe('order');
    expect(params.get('order')).toBe('asc');
    expect(params.get('depth')).toBe('1');
  });

  it('turns a 1-based page into an offset', () => {
    expect(new URLSearchParams(buildQueryString({ page: 3, limit: 10 })).get('offset')).toBe('20');
    expect(new URLSearchParams(buildQueryString({ page: 1, limit: 10 })).get('offset')).toBe('0');
  });

  it('ignores page without a limit, because the server cannot infer one', () => {
    expect(new URLSearchParams(buildQueryString({ page: 3 })).get('offset')).toBeNull();
  });

  it('prefers an explicit offset over page', () => {
    expect(
      new URLSearchParams(buildQueryString({ page: 3, limit: 10, offset: 5 })).get('offset')
    ).toBe('5');
  });

  it('writes a bare value as an equality filter', () => {
    expect(
      new URLSearchParams(buildQueryString({ where: { featured: true } })).get('featured')
    ).toBe('true');
  });

  it('writes an operator object as field[op]', () => {
    const params = new URLSearchParams(
      buildQueryString({ where: { price: { gte: 50, lt: 200 } } })
    );

    expect(params.get('price[gte]')).toBe('50');
    expect(params.get('price[lt]')).toBe('200');
  });

  it('joins an in-list with commas', () => {
    expect(
      new URLSearchParams(buildQueryString({ where: { id: { in: ['a', 'b', 'c'] } } })).get(
        'id[in]'
      )
    ).toBe('a,b,c');
  });

  it('serialises dates as ISO strings', () => {
    const date = new Date('2026-07-27T10:00:00.000Z');
    expect(
      new URLSearchParams(buildQueryString({ where: { publishedAt: { gt: date } } })).get(
        'publishedAt[gt]'
      )
    ).toBe(date.toISOString());
  });

  it('skips undefined conditions instead of sending the string "undefined"', () => {
    expect(buildQueryString({ where: { category: undefined } })).toBe('');
    expect(buildQueryString({ where: { price: { gte: undefined } } })).toBe('');
  });

  it('refuses filters that would collide with reserved parameters', () => {
    expect(buildQueryString({ where: { limit: 5, sort: 'x' } })).toBe('');
  });

  it('passes the draft status through', () => {
    expect(new URLSearchParams(buildQueryString({ status: 'all' })).get('status')).toBe('all');
  });

  it('serializes a top-level and/or where as ?where=<json> (spec 050)', () => {
    const where = {
      and: [{ status: 'published' }, { or: [{ featured: true }, { views: { gte: 100 } }] }]
    };
    const params = new URLSearchParams(buildQueryString({ where }));

    expect(params.get('featured')).toBeNull(); // not flattened into field params
    expect(JSON.parse(params.get('where')!)).toEqual(where);
  });

  it('serializes a multi-field sort as JSON (spec 050)', () => {
    const sort = [
      { field: 'featured', order: 'desc' as const },
      { field: 'views', order: 'asc' as const }
    ];
    const params = new URLSearchParams(buildQueryString({ sort }));

    expect(JSON.parse(params.get('sort')!)).toEqual(sort);
  });

  it('keeps single-field sort as a plain string (backward compatibility)', () => {
    const params = new URLSearchParams(buildQueryString({ sort: 'views', order: 'desc' }));
    expect(params.get('sort')).toBe('views');
    expect(params.get('order')).toBe('desc');
  });

  it('a flat where (no and/or) still serializes field-by-field, unchanged', () => {
    const params = new URLSearchParams(buildQueryString({ where: { category: 'news' } }));
    expect(params.get('category')).toBe('news');
    expect(params.get('where')).toBeNull();
  });
});
