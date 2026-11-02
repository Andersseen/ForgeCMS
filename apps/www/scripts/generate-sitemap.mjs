import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'front-matter';
import { CANONICAL_ORIGIN } from '../src/app/site-config.mjs';
import { SOURCE_LOCALE } from '../src/app/i18n/site-locales.mjs';
import { publicPages } from './public-routes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDirectory = resolve(root, 'src/content/docs');
const output = resolve(root, 'public/sitemap.xml');
const robotsOutput = resolve(root, 'public/robots.txt');

const docs = (await readdir(docsDirectory)).filter((filename) => filename.endsWith('.md')).sort();
for (const filename of docs) {
  const source = await readFile(resolve(docsDirectory, filename), 'utf8');
  const { attributes } = matter(source);
  if (typeof attributes.title !== 'string' || typeof attributes.description !== 'string') {
    throw new Error(`Documentation page ${filename} requires title and description frontmatter.`);
  }
}

// Spec 101: one <url> per page per locale it really exists in; a page with translations lists every
// alternate (itself included) plus x-default → English, as Google's sitemap hreflang format asks.
const pages = publicPages(root);
const entries = pages.flatMap((page) =>
  page.locales.map((locale) => ({ loc: page.urls[locale], page }))
);
const locs = entries.map((entry) => entry.loc);
if (new Set(locs).size !== locs.length) throw new Error('Duplicate sitemap routes found.');

const alternates = (page) =>
  page.locales.length < 2
    ? []
    : [
        ...page.locales.map((locale) => [locale, page.urls[locale]]),
        ['x-default', page.urls[SOURCE_LOCALE]]
      ].map(
        ([hreflang, path]) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${CANONICAL_ORIGIN}${path}"/>`
      );

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...entries.map(({ loc, page }) =>
    [`  <url>`, `    <loc>${CANONICAL_ORIGIN}${loc}</loc>`, ...alternates(page), `  </url>`].join(
      '\n'
    )
  ),
  '</urlset>',
  ''
].join('\n');

await writeFile(output, xml);
await writeFile(
  robotsOutput,
  `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`
);
stdout.write(`Generated robots.txt and ${entries.length} sitemap URLs\n`);
