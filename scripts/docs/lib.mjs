// Pure checks behind `scripts/docs/verify-docs.mjs` (spec 091, roadmap 0.12 / R04). Repository tooling only.
// No network, no installs: they read the working tree, so they are fast and deterministic.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** GitHub's heading → anchor rule (what the repository view and the website's marked-gfm-heading-id produce). */
export function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** Every anchor a Markdown document defines (duplicates get -1, -2 like GitHub). Fenced code is ignored. */
export function anchorsOf(markdown) {
  const anchors = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const explicit of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(explicit[1]);
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = headingSlug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** Inline links `[text](target)` outside fenced code and inline code, with their 1-based line. */
export function linksOf(markdown) {
  const links = [];
  let fenced = false;
  markdown.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const text = line.replace(/`[^`]*`/g, (code) => ' '.repeat(code.length));
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: match[1], line: index + 1 });
    }
    for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) {
      links.push({ target: match[1], line: index + 1 });
    }
  });
  return links;
}

export function stripFrontmatter(markdown) {
  return markdown.startsWith('---\n') ? markdown.replace(/^---\n[\s\S]*?\n---\n/, '') : markdown;
}

export const REPO_URL =
  /^https:\/\/github\.com\/Andersseen\/ForgeCMS\/(?:blob|tree)\/main\/([^#?]*)(?:#(.*))?$/;

/**
 * Checks every link of `files` (absolute paths) against the tree rooted at `root`.
 * - relative links: the file or directory must exist; a `#anchor` into a Markdown file must be one of its headings
 * - `/docs/<slug>[#anchor]`: `apps/www/src/content/docs/<slug>.md` must exist (and define the anchor)
 * - GitHub `blob|tree/main/<path>` links to this repository: the path must exist
 * - other `https://` links are returned in `external` (report-only; never a failure)
 */
export function checkLinks({ root, files, websiteDocs = 'apps/www/src/content/docs' }) {
  const failures = [];
  const external = new Set();
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(file, 'utf8'));
    return cache.get(file);
  };
  const hasAnchor = (file, anchor) => {
    if (!anchor) return true;
    const decoded = decodeURIComponent(anchor);
    return anchorsOf(stripFrontmatter(read(file))).has(decoded);
  };
  const rel = (file) => relative(root, file).split(sep).join('/');

  for (const file of files) {
    for (const { target, line } of linksOf(stripFrontmatter(read(file)))) {
      const where = `${rel(file)}:${line}`;
      if (/^(mailto:|tel:)/.test(target)) continue;
      if (/^https?:\/\//.test(target)) {
        const repo = REPO_URL.exec(target);
        if (repo) {
          const path = decodeURIComponent(repo[1]);
          const absolute = resolve(root, path);
          if (!existsSync(absolute))
            failures.push(`${where}: repository link to a missing path '${path}'`);
          else if (repo[2] && absolute.endsWith('.md') && !hasAnchor(absolute, repo[2])) {
            failures.push(`${where}: '${path}' has no heading '#${repo[2]}'`);
          }
        } else {
          external.add(target);
        }
        continue;
      }
      const [pathPart, anchor] = target.split('#');
      if (target.startsWith('#')) {
        if (!hasAnchor(file, target.slice(1)))
          failures.push(`${where}: no heading '${target}' in this file`);
        continue;
      }
      if (pathPart.startsWith('/docs/') || pathPart === '/docs') {
        const slug = pathPart.replace(/^\/docs\/?/, '');
        if (slug === '') continue; // the docs landing page
        const page = join(root, websiteDocs, `${slug}.md`);
        if (!existsSync(page))
          failures.push(`${where}: website page '/docs/${slug}' does not exist`);
        else if (!hasAnchor(page, anchor))
          failures.push(`${where}: '/docs/${slug}' has no heading '#${anchor}'`);
        continue;
      }
      if (pathPart.startsWith('/')) continue; // other site-absolute URLs (the website, not this tree)
      if (/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) continue;
      const absolute = resolve(dirname(file), decodeURIComponent(pathPart));
      if (!existsSync(absolute)) {
        failures.push(`${where}: broken relative link '${target}'`);
      } else if (
        anchor &&
        statSync(absolute).isFile() &&
        absolute.endsWith('.md') &&
        !hasAnchor(absolute, anchor)
      ) {
        failures.push(`${where}: '${pathPart}' has no heading '#${anchor}'`);
      }
    }
  }
  return { failures, external: [...external].sort() };
}

const SNIPPET = /<!--\s*snippet:\s*(\S+)\s*-->\s*\n```[^\n]*\n([\s\S]*?)\n```/g;

/** Every `<!-- snippet: path -->` + fenced block must equal that file (trailing whitespace aside). */
export function checkSnippets({ root, files }) {
  const failures = [];
  let count = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(SNIPPET)) {
      count++;
      const source = resolve(root, match[1]);
      const where = `${relative(root, file)}`;
      if (!existsSync(source)) {
        failures.push(`${where}: snippet source '${match[1]}' does not exist`);
        continue;
      }
      const expected = readFileSync(source, 'utf8').trimEnd();
      if (match[2].trimEnd() !== expected) {
        failures.push(
          `${where}: the snippet for '${match[1]}' has drifted from the file (copy it again)`
        );
      }
    }
    const marked = (text.match(/<!--\s*snippet:/g) ?? []).length;
    const matched = [...text.matchAll(SNIPPET)].length;
    if (marked !== matched) {
      failures.push(
        `${relative(root, file)}: a snippet marker is not followed by a fenced code block`
      );
    }
  }
  return { failures, count };
}

/**
 * The reference page must document every public entry point, and may not attribute an export to the wrong
 * package. `baselines` maps a specifier (`@forge-cms/core`, `@forge-cms/angular/server`) to its export names.
 * Sections are `## ` or `### ` headings whose text starts with the specifier in backticks.
 */
export function checkReference({ markdown, baselines }) {
  const failures = [];
  const specifiers = Object.keys(baselines);
  const sections = new Map();
  let current;
  for (const line of markdown.split('\n')) {
    const heading = /^#{2,3}\s+`(@forge-cms\/[a-z0-9/-]+)`/.exec(line);
    if (heading) {
      current = heading[1];
      sections.set(current, '');
    } else if (/^#{1,3}\s/.test(line)) {
      current = undefined;
    } else if (current) {
      sections.set(current, `${sections.get(current)}\n${line}`);
    }
  }
  const owners = new Map();
  for (const [specifier, names] of Object.entries(baselines)) {
    for (const name of names) owners.set(name, [...(owners.get(name) ?? []), specifier]);
  }
  for (const specifier of specifiers) {
    const body = sections.get(specifier);
    if (body === undefined) {
      failures.push(`REFERENCE: no section for ${specifier}`);
      continue;
    }
    const own = new Set(baselines[specifier]);
    for (const match of body.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)) {
      const name = match[1];
      if (own.has(name)) continue;
      const elsewhere = owners.get(name);
      if (elsewhere && !elsewhere.includes(specifier)) {
        failures.push(
          `REFERENCE: '${name}' is documented under ${specifier} but is exported by ${elsewhere.join(', ')}`
        );
      }
    }
  }
  return { failures, sections: [...sections.keys()] };
}

/** Phrases that were true once and must not come back into a current-facing document. */
export const STALE_PHRASES = [
  /no real CRUD runtime is implemented/i,
  /no real request handling is implemented/i,
  /early design phase/i,
  /nothing published yet/i,
  /everything is 0\.0\.0 and unpublished/i,
  /future ForgeCMS (?:auth|upload)/i,
  /not a remote deploy/i,
  /not a remote Cloudflare/i
];

export function checkStalePhrases({ root, files }) {
  const failures = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const pattern of STALE_PHRASES) {
          if (pattern.test(line))
            failures.push(`${relative(root, file)}:${index + 1}: stale claim /${pattern.source}/`);
        }
      });
  }
  return { failures };
}

/** All `.md` files below `dir`, skipping `skip` directory names. */
export function markdownFiles(dir, skip = ['node_modules', 'dist', '.git', '.turbo']) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full, skip));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
