import type { MarkedExtension } from 'marked';

/**
 * A marked extension that restores escaping for inline code spans.
 *
 * Analog's own renderer emits `codespan` as `<code>${text}</code>` with the text **unescaped**, so a
 * generic in backticks — `` `Promise<Post>` `` — reaches the DOM as a literal `<Post>` tag and
 * silently disappears. In documentation about a TypeScript API that is most of the interesting
 * identifiers (`DatabaseAdapter<TRecord>`, `CollectionData<typeof posts>`, `AuthUser | null`).
 *
 * Registered after Analog's own extension in `vite.config.ts`, so this renderer wins. Fenced code
 * blocks are unaffected — Prism tokenises those at build time and they already escape correctly.
 */

/** Escapes `&`, `<` and `>`, leaving existing entities (`&amp;`, `&#39;`) intact. */
export function escapeCodespanHtml(text: string): string {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[\da-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const escapeCodespans: MarkedExtension = {
  renderer: {
    codespan({ text }: { text: string }): string {
      return `<code>${escapeCodespanHtml(text)}</code>`;
    }
  }
};
