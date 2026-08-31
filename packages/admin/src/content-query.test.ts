import { describe, expect, it } from 'vitest';
import type { CollectionMeta } from '@forge-cms/angular';
import {
  buildListQuery,
  findSearchableField,
  pageAfterDelete,
  visibleCollections
} from './content-query.js';

function meta(overrides: Partial<CollectionMeta> = {}): CollectionMeta {
  return {
    slug: 'posts',
    name: 'Posts',
    description: '',
    fieldDefinitions: [],
    ...overrides
  };
}

describe('findSearchableField', () => {
  it('prefers useAsTitle when the field exists', () => {
    const collection = meta({
      useAsTitle: 'title',
      fieldDefinitions: [
        { name: 'title', kind: 'text', label: 'Title', required: false },
        { name: 'slug', kind: 'slug', label: 'Slug', required: false }
      ]
    });
    expect(findSearchableField(collection)).toBe('title');
  });

  it('falls back to the first text-ish field when useAsTitle is unset or missing', () => {
    const collection = meta({
      fieldDefinitions: [
        { name: 'count', kind: 'number', label: 'Count', required: false },
        { name: 'slug', kind: 'slug', label: 'Slug', required: false }
      ]
    });
    expect(findSearchableField(collection)).toBe('slug');
  });

  it('returns null when nothing is text-ish', () => {
    const collection = meta({
      fieldDefinitions: [{ name: 'count', kind: 'number', label: 'Count', required: false }]
    });
    expect(findSearchableField(collection)).toBeNull();
  });
});

describe('buildListQuery', () => {
  it('always sends the page, nothing else by default', () => {
    expect(
      buildListQuery({
        page: 1,
        sort: null,
        status: 'all',
        search: '',
        searchField: null,
        hasDrafts: false
      })
    ).toEqual({ page: 1 });
  });

  it('sends sort/order and status only for a drafts-enabled collection', () => {
    expect(
      buildListQuery({
        page: 2,
        sort: { field: 'title', order: 'asc' },
        status: 'draft',
        search: '',
        searchField: null,
        hasDrafts: true
      })
    ).toEqual({ page: 2, sort: 'title', order: 'asc', status: 'draft' });
  });

  it('ignores status for a non-drafts collection even when set', () => {
    const query = buildListQuery({
      page: 1,
      sort: null,
      status: 'draft',
      search: '',
      searchField: null,
      hasDrafts: false
    });
    expect(query.status).toBeUndefined();
  });

  it('builds a contains where clause only when both a term and a searchable field exist', () => {
    expect(
      buildListQuery({
        page: 1,
        sort: null,
        status: 'all',
        search: '  hello  ',
        searchField: 'title',
        hasDrafts: false
      })
    ).toEqual({ page: 1, where: { title: { contains: 'hello' } } });

    expect(
      buildListQuery({
        page: 1,
        sort: null,
        status: 'all',
        search: 'hello',
        searchField: null,
        hasDrafts: false
      }).where
    ).toBeUndefined();

    expect(
      buildListQuery({
        page: 1,
        sort: null,
        status: 'all',
        search: '   ',
        searchField: 'title',
        hasDrafts: false
      }).where
    ).toBeUndefined();
  });
});

describe('pageAfterDelete', () => {
  it('steps back a page when the deleted row was the last one past page 1', () => {
    expect(pageAfterDelete(3, 0)).toBe(2);
  });

  it('stays on page 1 even when it empties out', () => {
    expect(pageAfterDelete(1, 0)).toBe(1);
  });

  it('stays put when rows remain on the page', () => {
    expect(pageAfterDelete(2, 4)).toBe(2);
  });
});

describe('visibleCollections', () => {
  const posts = meta({ slug: 'posts' });
  const pages = meta({ slug: 'pages', name: 'Pages' });

  it('returns every collection when the host sets no restriction', () => {
    expect(visibleCollections([posts, pages], null)).toEqual([posts, pages]);
    expect(visibleCollections([posts, pages], {})).toEqual([posts, pages]);
  });

  it('filters and orders by the restriction, dropping slugs the API never returned', () => {
    const result = visibleCollections([posts, pages], {
      collections: [
        { slug: 'pages', fields: {} },
        { slug: 'missing', fields: {} }
      ]
    });
    expect(result).toEqual([pages]);
  });
});
