import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { applyAutoSlugs, applyFieldDefaults } from './defaults.js';

const collection = defineCollection({
  slug: 'articles',
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    status: defineField.select({ options: ['draft', 'review'], defaultValue: 'draft' }),
    views: defineField.number({ defaultValue: 0 }),
    featured: defineField.boolean({ defaultValue: false }),
    tags: defineField.json()
  }
});

describe('applyFieldDefaults', () => {
  it('fills fields the body omitted', () => {
    const result = applyFieldDefaults(collection, { title: 'Hello' });

    expect(result.status).toBe('draft');
    expect(result.views).toBe(0);
    expect(result.featured).toBe(false);
  });

  it('never overwrites a value the caller provided', () => {
    const result = applyFieldDefaults(collection, { title: 'Hello', status: 'review', views: 12 });

    expect(result.status).toBe('review');
    expect(result.views).toBe(12);
  });

  it('treats an explicit falsy value as provided', () => {
    const provided = defineCollection({
      slug: 'x',
      fields: { flag: defineField.boolean({ defaultValue: true }) }
    });

    expect(applyFieldDefaults(provided, { flag: false }).flag).toBe(false);
  });

  it('leaves fields without a default alone', () => {
    expect(applyFieldDefaults(collection, { title: 'Hello' })).not.toHaveProperty('tags');
  });

  it('does not mutate the input', () => {
    const input = { title: 'Hello' };
    applyFieldDefaults(collection, input);
    expect(input).toEqual({ title: 'Hello' });
  });
});

describe('applyAutoSlugs', () => {
  it('derives a slug from the source field', () => {
    expect(applyAutoSlugs(collection, { title: 'Láser & Piel: sesión 2' }).slug).toBe(
      'laser-piel-sesion-2'
    );
  });

  it('normalises a slug the caller provided instead of replacing it', () => {
    expect(applyAutoSlugs(collection, { title: 'Hello', slug: 'My Custom Slug' }).slug).toBe(
      'my-custom-slug'
    );
  });

  it('treats an empty string as "generate one for me"', () => {
    expect(applyAutoSlugs(collection, { title: 'Hello there', slug: '' }).slug).toBe('hello-there');
  });

  it('falls back to title/name when no sourceField is named', () => {
    const implicit = defineCollection({
      slug: 'people',
      fields: {
        name: defineField.text(),
        slug: defineField.slug({ autoGenerate: true })
      }
    });

    expect(applyAutoSlugs(implicit, { name: 'Dr. Elena Marchetti' }).slug).toBe(
      'dr-elena-marchetti'
    );
  });

  it('does not touch slugs on collections that did not opt in', () => {
    const manual = defineCollection({
      slug: 'pages',
      fields: { title: defineField.text(), slug: defineField.slug() }
    });

    expect(applyAutoSlugs(manual, { title: 'Hello' })).not.toHaveProperty('slug');
  });

  it('keeps an existing slug when an update does not mention it', () => {
    const result = applyAutoSlugs(
      collection,
      { title: 'A brand new title' },
      { slug: 'the-original-url', title: 'Old title' }
    );

    expect(result.slug).toBeUndefined();
  });

  it('regenerates when an update explicitly clears the slug', () => {
    const result = applyAutoSlugs(
      collection,
      { title: 'A brand new title', slug: '' },
      { slug: 'the-original-url', title: 'Old title' }
    );

    expect(result.slug).toBe('a-brand-new-title');
  });

  it('leaves the field alone when the source has nothing sluggable', () => {
    expect(applyAutoSlugs(collection, { title: '###' }).slug).toBeUndefined();
  });
});
