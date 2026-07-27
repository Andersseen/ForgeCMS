import { describe, expect, it } from 'vitest';
import type { FieldMeta } from '@forge-cms/angular';
import { toCellView } from './cell-value.js';
import { normaliseReferences } from './references.js';
import { documentImageUrl, documentLabel, richTextToPlainText, shortId } from './document-label.js';

function field(kind: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return { name: 'f', kind, label: 'F', required: false, ...extra };
}

describe('toCellView', () => {
  it('shows a dash for anything empty', () => {
    for (const value of [undefined, null, '', []]) {
      expect(toCellView(field('text'), value)).toEqual({ kind: 'muted', text: '—' });
    }
  });

  it('reads richtext as plain text instead of [object Object]', () => {
    const body = [
      { type: 'paragraph', children: [{ type: 'text', text: 'Skin reading first.' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Then a plan.' }] }
    ];

    expect(toCellView(field('richtext'), body)).toEqual({
      kind: 'muted',
      text: 'Skin reading first. Then a plan.'
    });
  });

  it('labels a populated relation instead of showing a UUID', () => {
    const view = toCellView(field('relation'), { id: 'abc', name: 'Sofia Rey' });
    expect(view).toEqual({ kind: 'text', text: 'Sofia Rey' });
  });

  it('summarises a long list of relations', () => {
    const view = toCellView(field('relation'), [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '3', name: 'C' }
    ]);

    expect(view).toEqual({ kind: 'count', text: 'A +2' });
  });

  it('renders a populated upload as a thumbnail', () => {
    const view = toCellView(field('upload'), {
      id: 'm1',
      filename: 'facial.png',
      url: '/api/media/media/facial.png',
      contentType: 'image/png'
    });

    expect(view).toEqual({ kind: 'image', url: '/api/media/media/facial.png', text: 'facial.png' });
  });

  it('falls back to a short id for an unpopulated upload', () => {
    expect(toCellView(field('upload'), '0a1b2c3d-4e5f-6789-abcd-ef0123456789')).toEqual({
      kind: 'muted',
      text: '0a1b2c3d…'
    });
  });

  it('counts composite values', () => {
    expect(toCellView(field('array'), [{}, {}])).toEqual({ kind: 'count', text: '2 rows' });
    expect(toCellView(field('array'), [{}])).toEqual({ kind: 'count', text: '1 row' });
    expect(toCellView(field('group'), { a: 1, b: 2 })).toEqual({ kind: 'count', text: '2 fields' });
    expect(toCellView(field('blocks'), [{ blockType: 'hero' }, { blockType: 'cta' }])).toEqual({
      kind: 'count',
      text: 'hero · cta'
    });
  });

  it('formats scalars', () => {
    expect(toCellView(field('boolean'), true)).toEqual({ kind: 'text', text: 'Yes' });
    expect(toCellView(field('boolean'), false)).toEqual({ kind: 'text', text: 'No' });
    expect(toCellView(field('number'), 95)).toEqual({ kind: 'text', text: '95' });
    // A zero is a value, not an absence: a free treatment shows "0", not a dash.
    expect(toCellView(field('number'), 0)).toEqual({ kind: 'text', text: '0' });
    expect(toCellView(field('date'), 'not-a-date')).toEqual({ kind: 'text', text: 'not-a-date' });
  });
});

describe('document helpers', () => {
  it('prefers a human field over the id', () => {
    expect(documentLabel({ id: 'x', title: 'Peel' })).toBe('Peel');
    expect(documentLabel({ id: 'x', filename: 'a.png' })).toBe('a.png');
    expect(documentLabel({ id: '0a1b2c3d-4e5f' })).toBe('0a1b2c3d…');
    expect(documentLabel(null)).toBe('—');
  });

  it('only treats image-like objects as previewable', () => {
    expect(documentImageUrl({ url: '/a.png' })).toBe('/a.png');
    expect(documentImageUrl({ url: '/a.pdf', contentType: 'application/pdf' })).toBeNull();
    expect(documentImageUrl({ url: '/a', contentType: 'image/webp' })).toBe('/a');
  });

  it('flattens nested richtext', () => {
    expect(
      richTextToPlainText([
        {
          type: 'p',
          children: [
            { type: 'text', text: 'one' },
            { type: 'text', text: 'two' }
          ]
        }
      ])
    ).toBe('one two');
  });

  it('leaves short ids alone', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('')).toBe('—');
  });
});

describe('normaliseReferences', () => {
  const fields: FieldMeta[] = [
    { name: 'category', kind: 'relation', label: 'Category', required: false },
    { name: 'tags', kind: 'relation', label: 'Tags', required: false },
    { name: 'image', kind: 'upload', label: 'Image', required: false },
    { name: 'title', kind: 'text', label: 'Title', required: false }
  ];

  it('turns populated documents back into ids before a form submits them', () => {
    const result = normaliseReferences(fields, {
      title: 'Facial',
      category: { id: 'cat-1', name: 'Facials' },
      tags: [{ id: 't1' }, { id: 't2' }],
      image: { id: 'm1', url: '/a.png' }
    });

    expect(result).toEqual({
      title: 'Facial',
      category: 'cat-1',
      tags: ['t1', 't2'],
      image: 'm1'
    });
  });

  it('leaves plain ids and unrelated fields untouched', () => {
    const value = { title: 'Facial', category: 'cat-1', tags: ['t1'], image: '' };
    expect(normaliseReferences(fields, value)).toBe(value);
  });

  it('keeps nulls as nulls rather than inventing an empty id', () => {
    expect(normaliseReferences(fields, { category: null })).toEqual({ category: null });
  });
});
