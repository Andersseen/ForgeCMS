import { describe, expect, it } from 'vitest';
import { matchesWhere, normalizeSort } from './where.js';

describe('matchesWhere', () => {
  const record = { id: '1', status: 'published', category: 'news', featured: true, views: 50 };

  it('matches everything when where is undefined', () => {
    expect(matchesWhere(record, undefined)).toBe(true);
  });

  it('matches everything for an empty flat where', () => {
    expect(matchesWhere(record, {})).toBe(true);
  });

  it('implicit-ANDs flat fields (backward compatible)', () => {
    expect(matchesWhere(record, { status: 'published', category: 'news' })).toBe(true);
    expect(matchesWhere(record, { status: 'published', category: 'opinion' })).toBe(false);
  });

  it('ANDs a top-level `and` group', () => {
    expect(matchesWhere(record, { and: [{ status: 'published' }, { category: 'news' }] })).toBe(
      true
    );
    expect(matchesWhere(record, { and: [{ status: 'published' }, { category: 'opinion' }] })).toBe(
      false
    );
  });

  it('ORs a top-level `or` group', () => {
    expect(matchesWhere(record, { or: [{ category: 'news' }, { featured: false }] })).toBe(true);
    expect(matchesWhere(record, { or: [{ category: 'opinion' }, { featured: false }] })).toBe(
      false
    );
  });

  it('nests groups recursively', () => {
    const where = {
      and: [{ status: 'published' }, { or: [{ category: 'opinion' }, { featured: true }] }]
    };
    expect(matchesWhere(record, where)).toBe(true);
    expect(matchesWhere({ ...record, featured: false, category: 'opinion' }, where)).toBe(true);
    // status is still 'published' (and-branch ok), but neither or-branch matches now.
    expect(matchesWhere({ ...record, featured: false, category: 'news' }, where)).toBe(false);
    // the and-branch itself fails, regardless of the or-branch.
    expect(matchesWhere({ ...record, status: 'draft' }, where)).toBe(false);
  });

  it('an empty `and: []` matches everything (empty conjunction)', () => {
    expect(matchesWhere(record, { and: [] })).toBe(true);
  });

  it('an empty `or: []` matches nothing (empty disjunction) — the access-rule deny-all case', () => {
    expect(matchesWhere(record, { or: [] })).toBe(false);
  });

  it('ANDs a flat key with a sibling `and`/`or` group instead of dropping the flat key', () => {
    expect(matchesWhere(record, { status: 'draft', or: [{ category: 'news' }] })).toBe(false);
    expect(matchesWhere(record, { status: 'published', or: [{ category: 'news' }] })).toBe(true);
    expect(matchesWhere(record, { status: 'published', or: [{ category: 'opinion' }] })).toBe(
      false
    );
  });

  it('filters relation-array membership with containsValue', () => {
    const withTags = { ...record, tags: ['a', 'b'] };
    expect(matchesWhere(withTags, { tags: { containsValue: 'a' } })).toBe(true);
    expect(matchesWhere(withTags, { tags: { containsValue: 'z' } })).toBe(false);
    expect(matchesWhere({ ...record, tags: [] }, { tags: { containsValue: 'a' } })).toBe(false);
  });
});

describe('normalizeSort', () => {
  it('returns an empty array for undefined', () => {
    expect(normalizeSort(undefined)).toEqual([]);
  });

  it('wraps a single field name, folding in the legacy standalone order', () => {
    expect(normalizeSort('views')).toEqual([{ field: 'views' }]);
    expect(normalizeSort('views', 'desc')).toEqual([{ field: 'views', order: 'desc' }]);
  });

  it('passes a multi-field sort through unchanged, ignoring the legacy order param', () => {
    const sort = [{ field: 'featured', order: 'desc' as const }, { field: 'views' }];
    expect(normalizeSort(sort, 'asc')).toEqual(sort);
  });
});
