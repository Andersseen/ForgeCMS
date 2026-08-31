/**
 * How the admin refers to a document it only has as data: a relation cell, a picker option, a media
 * caption. Before spec 042 these all rendered the raw UUID.
 */
const LABEL_FIELDS = ['title', 'name', 'label', 'filename', 'heading', 'email', 'author', 'slug'];

/**
 * Extracts something human from a document, falling back to a shortened id.
 *
 * `useAsTitle` (a collection's `admin.useAsTitle`, spec 052) wins over the heuristic field list
 * when it names a field the document actually has a non-empty string value for — an explicit config
 * beats a guess.
 */
export function documentLabel(doc: unknown, useAsTitle?: string): string {
  if (typeof doc === 'string') return shortId(doc);
  if (typeof doc !== 'object' || doc === null) return '—';

  const record = doc as Record<string, unknown>;

  if (useAsTitle !== undefined) {
    const value = record[useAsTitle];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }

  for (const field of LABEL_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }

  return shortId(String(record.id ?? ''));
}

/** A UUID is unreadable in a table cell; its first segment is enough to recognise a row. */
export function shortId(id: string): string {
  if (id === '') return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** The URL of an upload document, when it has been populated (`depth: 1`). */
export function documentImageUrl(doc: unknown): string | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const record = doc as Record<string, unknown>;
  const url = record.url;
  if (typeof url !== 'string' || url === '') return null;

  const contentType = typeof record.contentType === 'string' ? record.contentType : '';
  const looksLikeImage =
    contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url);
  return looksLikeImage ? url : null;
}

/** Flattens a richtext tree to plain text for previews. */
export function richTextToPlainText(value: unknown): string {
  if (Array.isArray(value)) return value.map(richTextToPlainText).filter(Boolean).join(' ');
  if (typeof value !== 'object' || value === null) return '';

  const node = value as Record<string, unknown>;
  const own = typeof node.text === 'string' ? node.text : '';
  const children = 'children' in node ? richTextToPlainText(node.children) : '';
  return [own, children].filter(Boolean).join(' ').trim();
}

export function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
