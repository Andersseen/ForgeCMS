import { describe, expect, it } from 'vitest';
import {
  defineBlock,
  defineCollection,
  defineField,
  defineGlobal,
  slugify,
  type CollectionData
} from './index';

describe('core schema DSL', () => {
  it('defines a typed collection', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        title: defineField.text({ required: true }),
        views: defineField.number(),
        published: defineField.boolean(),
        publishedAt: defineField.date({ withTime: true }),
        author: defineField.relation({ collection: 'users' })
      }
    });

    const example: CollectionData<typeof posts> = {
      title: 'Hello ForgeCMS',
      views: 1,
      published: true,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      author: 'user-1'
    };

    expect(posts.slug).toBe('posts');
    expect(posts.fields.title.kind).toBe('text');
    expect(example.title).toBe('Hello ForgeCMS');
  });

  it('rejects unsafe collection and field identifiers early', () => {
    expect(() =>
      defineCollection({
        slug: 'posts";',
        fields: { title: defineField.text() }
      })
    ).toThrow('Collection slug');

    expect(() =>
      defineCollection({
        slug: 'posts',
        fields: { 'field.name': defineField.text() }
      })
    ).toThrow('Field name "field.name"');
  });

  it('rejects unsafe nested field and block identifiers', () => {
    expect(() =>
      defineCollection({
        slug: 'pages',
        fields: {
          hero: defineField.group({
            fields: { 'bad field': defineField.text() }
          })
        }
      })
    ).toThrow('hero.bad field');

    expect(() =>
      defineCollection({
        slug: 'pages',
        fields: {
          layout: defineField.blocks({
            blocks: [defineBlock({ slug: '123copy', fields: { title: defineField.text() } })]
          })
        }
      })
    ).toThrow('Block slug');
  });

  it('rejects unsafe global identifiers early', () => {
    expect(() =>
      defineGlobal({
        slug: 'site.config',
        fields: { title: defineField.text() }
      })
    ).toThrow('Global slug');
  });

  describe('reserved Forge internal namespace', () => {
    it('rejects a consumer collection slug using the _forge_ prefix', () => {
      expect(() =>
        defineCollection({
          slug: '_forge_api_keys',
          fields: { title: defineField.text() }
        })
      ).toThrow(/reserved Forge internal prefix/);

      expect(() =>
        defineCollection({
          slug: '_forge_anything_else',
          fields: { title: defineField.text() }
        })
      ).toThrow(/reserved Forge internal prefix/);
    });

    it('rejects a consumer global slug using the _forge_ prefix', () => {
      expect(() =>
        defineGlobal({
          slug: '_forge_settings',
          fields: { title: defineField.text() }
        })
      ).toThrow(/reserved Forge internal prefix/);
    });

    it('does not reject an ordinary single-underscore-prefixed slug', () => {
      // Only the literal `_forge_` prefix is reserved — a consumer's own internal-looking slug
      // (single leading underscore, not `_forge_`) is a valid identifier and stays allowed.
      expect(() =>
        defineCollection({
          slug: '_archive',
          fields: { title: defineField.text() }
        })
      ).not.toThrow();
    });
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Signature HydraGlow Facial')).toBe('signature-hydraglow-facial');
  });

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Láser & Piel')).toBe('laser-piel');
    expect(slugify('Cañón')).toBe('canon');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(slugify('  ¿Qué es el peeling? — guía  ')).toBe('que-es-el-peeling-guia');
  });

  it('returns an empty string when there is nothing sluggable', () => {
    expect(slugify('###')).toBe('');
  });

  it('leaves an already-valid slug untouched', () => {
    expect(slugify('laser-hair-removal')).toBe('laser-hair-removal');
  });
});
