import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'front-matter';
import { CANONICAL_ORIGIN } from '../src/app/site-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDirectory = resolve(root, 'src/content/docs');
const output = resolve(root, 'public/sitemap.xml');
const robotsOutput = resolve(root, 'public/robots.txt');

const docs = (await readdir(docsDirectory)).filter((filename) => filename.endsWith('.md')).sort();
const urls = ['/', '/demo', '/privacy'];

for (const filename of docs) {
  const source = await readFile(resolve(docsDirectory, filename), 'utf8');
  const { attributes } = matter(source);
  if (typeof attributes.title !== 'string' || typeof attributes.description !== 'string') {
    throw new Error(`Documentation page ${filename} requires title and description frontmatter.`);
  }
  urls.push(`/docs/${filename.slice(0, -3)}`);
}

const uniqueUrls = [...new Set(urls)];
if (uniqueUrls.length !== urls.length) throw new Error('Duplicate sitemap routes found.');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...uniqueUrls.map((path) => `  <url><loc>${CANONICAL_ORIGIN}${path}</loc></url>`),
  '</urlset>',
  ''
].join('\n');

await writeFile(output, xml);
await writeFile(
  robotsOutput,
  `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`
);
stdout.write(`Generated robots.txt and ${uniqueUrls.length} sitemap URLs\n`);
