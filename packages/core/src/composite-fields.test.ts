import { describe, expect, it } from 'vitest';
import {
  defineBlock,
  defineCollection,
  defineField,
  isCompositeKind,
  validateCollection,
  type CollectionData
} from './index.js';

describe('group fields', () => {
  const page = defineCollection({
    slug: 'pages',
    fields: {
      title: defineField.text({ required: true }),
      seo: defineField.group({
        fields: {
          metaTitle: defineField.text({ required: true }),
          metaDescription: defineField.textarea(),
          noIndex: defineField.boolean()
        }
      })
    }
  });

  it('accepts a well-formed nested object', () => {
    const result = validateCollection(page, {
      title: 'Home',
      seo: { metaTitle: 'Home page', noIndex: false }
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a non-object value', () => {
    const result = validateCollection(page, { title: 'Home', seo: 'nope' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ field: 'seo', code: 'type_group' });
  });

  it('reports nested failures with a dotted path', () => {
    const result = validateCollection(page, { title: 'Home', seo: { metaTitle: 123 } });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain('seo.metaTitle');
  });

  it('applies nested required rules', () => {
    const result = validateCollection(page, { title: 'Home', seo: {} });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'seo.metaTitle', code: 'required' })
    );
  });

  it('infers the nested shape', () => {
    type Data = CollectionData<typeof page>;
    const data: Data = {
      title: 'Home',
      seo: { metaTitle: 'x', metaDescription: 'y', noIndex: true }
    };
    expect(data.seo.metaTitle).toBe('x');
  });
});

describe('array fields', () => {
  const recipe = defineCollection({
    slug: 'recipes',
    fields: {
      name: defineField.text({ required: true }),
      steps: defineField.array({
        minRows: 1,
        maxRows: 3,
        fields: {
          instruction: defineField.text({ required: true }),
          minutes: defineField.number({ min: 0 })
        }
      })
    }
  });

  it('accepts well-formed rows', () => {
    const result = validateCollection(recipe, {
      name: 'Toast',
      steps: [{ instruction: 'Toast the bread', minutes: 3 }]
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a non-array value', () => {
    const result = validateCollection(recipe, { name: 'Toast', steps: {} });
    expect(result.errors[0]).toMatchObject({ field: 'steps', code: 'type_array' });
  });

  it('enforces minRows and maxRows', () => {
    const tooFew = validateCollection(recipe, { name: 'Toast', steps: [] });
    expect(tooFew.errors).toContainEqual(expect.objectContaining({ code: 'minRows' }));

    const row = { instruction: 'x' };
    const tooMany = validateCollection(recipe, { name: 'Toast', steps: [row, row, row, row] });
    expect(tooMany.errors).toContainEqual(expect.objectContaining({ code: 'maxRows' }));
  });

  it('reports the failing row by index', () => {
    const result = validateCollection(recipe, {
      name: 'Toast',
      steps: [{ instruction: 'ok' }, { minutes: 2 }]
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'steps.1.instruction', code: 'required' })
    );
  });

  it('validates nested constraints inside a row', () => {
    const result = validateCollection(recipe, {
      name: 'Toast',
      steps: [{ instruction: 'ok', minutes: -5 }]
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'steps.0.minutes', code: 'min' })
    );
  });
});

describe('blocks fields', () => {
  const hero = defineBlock({
    slug: 'hero',
    fields: {
      heading: defineField.text({ required: true }),
      image: defineField.text()
    }
  });

  const quote = defineBlock({
    slug: 'quote',
    fields: {
      body: defineField.textarea({ required: true }),
      attribution: defineField.text()
    }
  });

  const landing = defineCollection({
    slug: 'landing',
    fields: {
      title: defineField.text({ required: true }),
      sections: defineField.blocks({ blocks: [hero, quote] })
    }
  });

  it('accepts a mixed list of known blocks', () => {
    const result = validateCollection(landing, {
      title: 'Home',
      sections: [
        { blockType: 'hero', heading: 'Welcome' },
        { blockType: 'quote', body: 'Ship it.', attribution: 'Someone' }
      ]
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a row with no blockType', () => {
    const result = validateCollection(landing, {
      title: 'Home',
      sections: [{ heading: 'Welcome' }]
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'sections.0', code: 'block_type' })
    );
  });

  it('rejects an unknown blockType and names the valid ones', () => {
    const result = validateCollection(landing, {
      title: 'Home',
      sections: [{ blockType: 'carousel' }]
    });
    const error = result.errors.find((e) => e.field === 'sections.0');
    expect(error?.code).toBe('block_type');
    expect(error?.message).toContain('hero, quote');
  });

  it("validates each row against its own block's fields", () => {
    const result = validateCollection(landing, {
      title: 'Home',
      sections: [{ blockType: 'hero', heading: 'ok' }, { blockType: 'quote' }]
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'sections.1.body', code: 'required' })
    );
  });
});

describe('nesting depth', () => {
  it('validates a group inside an array inside a group', () => {
    const deep = defineCollection({
      slug: 'deep',
      fields: {
        layout: defineField.group({
          fields: {
            rows: defineField.array({
              fields: {
                cell: defineField.group({
                  fields: { label: defineField.text({ required: true }) }
                })
              }
            })
          }
        })
      }
    });

    const result = validateCollection(deep, {
      layout: { rows: [{ cell: { label: 'ok' } }, { cell: {} }] }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'layout.rows.1.cell.label', code: 'required' })
    );
  });
});

describe('isCompositeKind', () => {
  it('identifies the kinds stored as JSON', () => {
    expect(isCompositeKind('group')).toBe(true);
    expect(isCompositeKind('array')).toBe(true);
    expect(isCompositeKind('blocks')).toBe(true);
    expect(isCompositeKind('text')).toBe(false);
    expect(isCompositeKind('json')).toBe(false);
  });
});
