import type { FieldMeta } from '@forge-cms/angular';
import {
  documentImageUrl,
  documentLabel,
  richTextToPlainText,
  truncate
} from './document-label.js';

/** What a table cell should draw: a thumbnail, a badge-ish count, or plain text. */
export type CellView =
  | { kind: 'text'; text: string }
  | { kind: 'muted'; text: string }
  | { kind: 'image'; url: string; text: string }
  | { kind: 'count'; text: string };

const EMPTY: CellView = { kind: 'muted', text: '—' };

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Renders one document field as a list cell.
 *
 * Before spec 042 the list stringified everything, so a `richtext` column read
 * `[object Object], [object Object]`, a relation showed a raw UUID, and a `group` showed
 * `[object Object]` — the three kinds a content editor most needs to recognise at a glance.
 */
export function toCellView(field: FieldMeta, value: unknown): CellView {
  if (isEmpty(value)) return EMPTY;

  switch (field.kind) {
    case 'boolean':
      return { kind: 'text', text: value ? 'Yes' : 'No' };

    case 'date': {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime())
        ? { kind: 'text', text: String(value) }
        : { kind: 'text', text: date.toLocaleDateString() };
    }

    case 'richtext': {
      const text = richTextToPlainText(value);
      return text === '' ? EMPTY : { kind: 'muted', text: truncate(text) };
    }

    case 'textarea':
      return { kind: 'muted', text: truncate(String(value)) };

    case 'upload': {
      // With `depth: 1` this is the media document; without it, a bare id.
      const url = documentImageUrl(value);
      const label = documentLabel(value);
      return url ? { kind: 'image', url, text: label } : { kind: 'muted', text: label };
    }

    case 'relation': {
      if (Array.isArray(value)) {
        const labels = value.map(documentLabel);
        return labels.length <= 2
          ? { kind: 'text', text: labels.join(', ') }
          : { kind: 'count', text: `${labels[0]} +${labels.length - 1}` };
      }
      return { kind: 'text', text: documentLabel(value) };
    }

    case 'group':
      return { kind: 'count', text: `${Object.keys(value as object).length} fields` };

    case 'array': {
      const rows = value as unknown[];
      return { kind: 'count', text: rows.length === 1 ? '1 row' : `${rows.length} rows` };
    }

    case 'blocks': {
      const rows = value as { blockType?: string }[];
      const types = rows.map((row) => row.blockType).filter(Boolean);
      return { kind: 'count', text: truncate(types.join(' · ') || `${rows.length} blocks`, 40) };
    }

    case 'json':
      return { kind: 'muted', text: truncate(JSON.stringify(value), 60) };

    case 'number':
      return { kind: 'text', text: String(value) };

    default:
      return { kind: 'text', text: truncate(String(value)) };
  }
}
