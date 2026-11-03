/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/**
 * Spec 101: a translated docs article is the English article in another language — same place in
 * the nav, byte-identical code, and links only to pages that exist where they point.
 */
const files = import.meta.glob<string>('/src/content/**/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
});

const english = new Map<string, string>();
const translated = new Map<string, Map<string, string>>([
  ['es', new Map()],
  ['uk', new Map()]
]);
for (const [path, source] of Object.entries(files)) {
  const match = /\/src\/content\/(?:(es|uk)\/)?docs\/([a-z0-9-]+)\.md$/.exec(path);
  if (!match?.[2]) continue;
  if (match[1]) translated.get(match[1])!.set(match[2], source);
  else english.set(match[2], source);
}

const frontmatter = (source: string, field: string) =>
  new RegExp(`^${field}: (.*)$`, 'm').exec(source.split('---')[1] ?? '')?.[1];
const codeBlocks = (source: string) => source.match(/```[a-z]*\n[\s\S]*?\n```/g) ?? [];
const links = (source: string) =>
  [...source.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) => match[1]!.split('#')[0]!);

describe('translated docs articles (spec 101)', () => {
  it('cover the first increment in both languages', () => {
    for (const locale of ['es', 'uk']) {
      expect([...translated.get(locale)!.keys()].sort(), locale).toEqual([
        'introduction',
        'quickstart',
        'small-project-guide'
      ]);
    }
  });

  for (const [locale, articles] of translated) {
    for (const [slug, source] of articles) {
      const original = english.get(slug);

      it(`${locale}/${slug} keeps its English original's nav position and code`, () => {
        expect(original, 'an English original exists').toBeDefined();
        expect(frontmatter(source, 'group')).toBe(frontmatter(original!, 'group'));
        expect(frontmatter(source, 'order')).toBe(frontmatter(original!, 'order'));
        expect(frontmatter(source, 'title')).not.toBe(frontmatter(original!, 'title'));
        expect(codeBlocks(source)).toEqual(codeBlocks(original!));
      });

      it(`${locale}/${slug} links only to pages that exist`, () => {
        for (const href of links(source)) {
          const localized = new RegExp(`^/${locale}/docs/([a-z0-9-]+)$`).exec(href);
          if (localized) {
            expect(articles.has(localized[1]!), `${href} is translated`).toBe(true);
            continue;
          }
          const docs = /^\/docs\/([a-z0-9-]+)$/.exec(href);
          expect(docs, `${href} is a docs link`).not.toBeNull();
          expect(english.has(docs![1]!), `${href} exists in English`).toBe(true);
        }
      });
    }
  }
});
