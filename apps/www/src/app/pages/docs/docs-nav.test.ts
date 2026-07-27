import { describe, expect, it } from 'vitest';
import {
  buildDocsNav,
  findAdjacent,
  flattenDocsNav,
  isDocsFile,
  type DocsContentFile
} from './docs-nav';

function file(
  slug: string,
  attributes: DocsContentFile['attributes'],
  filename = `/src/content/docs/${slug}.md`
): DocsContentFile {
  return { slug, filename, attributes };
}

describe('buildDocsNav', () => {
  it('orders groups by DOCS_GROUP_ORDER, not by discovery order', () => {
    const nav = buildDocsNav([
      file('rest-api', { title: 'REST API', group: 'Server APIs' }),
      file('introduction', { title: 'Introduction', group: 'Getting started' }),
      file('fields', { title: 'Fields', group: 'Content modelling' })
    ]);

    expect(nav.map((group) => group.heading)).toEqual([
      'Getting started',
      'Content modelling',
      'Server APIs'
    ]);
  });

  it('sorts within a group by `order`, then by title', () => {
    const nav = buildDocsNav([
      file('concepts', { title: 'Concepts', group: 'Getting started', order: 3 }),
      file('introduction', { title: 'Introduction', group: 'Getting started', order: 1 }),
      file('quickstart', { title: 'Quickstart', group: 'Getting started', order: 2 })
    ]);

    expect(nav[0]?.links.map((link) => link.slug)).toEqual([
      'introduction',
      'quickstart',
      'concepts'
    ]);
  });

  it('puts pages without `order` after ordered ones, alphabetically', () => {
    const nav = buildDocsNav([
      file('zebra', { title: 'Zebra', group: 'Getting started' }),
      file('alpha', { title: 'Alpha', group: 'Getting started' }),
      file('first', { title: 'First', group: 'Getting started', order: 1 })
    ]);

    expect(nav[0]?.links.map((link) => link.slug)).toEqual(['first', 'alpha', 'zebra']);
  });

  it('keeps an unknown group visible, after the known ones', () => {
    const nav = buildDocsNav([
      file('recipes', { title: 'Recipes', group: 'Cookbook' }),
      file('introduction', { title: 'Introduction', group: 'Getting started' })
    ]);

    expect(nav.map((group) => group.heading)).toEqual(['Getting started', 'Cookbook']);
  });

  it('falls back to the slug when a page forgets its title', () => {
    const nav = buildDocsNav([file('orphan', {})]);

    expect(nav[0]?.links[0]).toEqual({ slug: 'orphan', title: 'orphan' });
  });
});

describe('findAdjacent', () => {
  const links = flattenDocsNav(
    buildDocsNav([
      file('introduction', { title: 'Introduction', group: 'Getting started', order: 1 }),
      file('quickstart', { title: 'Quickstart', group: 'Getting started', order: 2 }),
      file('fields', { title: 'Fields', group: 'Content modelling', order: 1 })
    ])
  );

  it('walks across group boundaries', () => {
    expect(findAdjacent(links, 'quickstart')).toEqual({
      prev: { slug: 'introduction', title: 'Introduction' },
      next: { slug: 'fields', title: 'Fields' }
    });
  });

  it('omits the missing neighbour at either end', () => {
    expect(findAdjacent(links, 'introduction').prev).toBeUndefined();
    expect(findAdjacent(links, 'fields').next).toBeUndefined();
  });

  it('returns nothing for an unknown slug', () => {
    expect(findAdjacent(links, 'nope')).toEqual({});
  });
});

describe('isDocsFile', () => {
  it('ignores content outside src/content/docs', () => {
    expect(isDocsFile(file('introduction', {}))).toBe(true);
    expect(isDocsFile(file('post', {}, '/src/content/blog/post.md'))).toBe(false);
  });
});
