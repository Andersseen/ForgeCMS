import type { MessagePart } from '@etyma/core';

/** A run of text and the one MessageFormat 2 markup element it sits in (`code`, `strong`, `link`). */
export interface MessageSegment {
  readonly text: string;
  readonly tag: string | null;
}

/**
 * Flattens `parts()` output into text runs tagged with their enclosing markup, so a translation can
 * say where inline `<code>` or a link goes (`{#link}Read the notice{/link}`) and the template renders
 * real elements — never `innerHTML`. Markup does not nest in this site's catalogs; an inner element
 * simply replaces the outer one until it closes.
 */
export function messageSegments(parts: readonly MessagePart[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let tag: string | null = null;
  for (const part of parts) {
    // `type` alone does not narrow: an expression part's `type` is any string.
    if (part.type === 'markup' && 'kind' in part) {
      tag = part.kind === 'open' ? part.name : null;
      continue;
    }
    const text = partText(part);
    if (text !== '') segments.push({ text, tag });
  }
  return segments;
}

function partText(part: MessagePart): string {
  if ('value' in part && typeof part.value === 'string') return part.value;
  if ('parts' in part && Array.isArray(part.parts)) {
    return part.parts.map((inner: { value?: unknown }) => String(inner.value ?? '')).join('');
  }
  return '';
}
