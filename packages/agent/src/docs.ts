import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DOCS_DIR, SKILLS_DIR, packageVersion } from './package-info.js';
import { cleanText } from './project-reader.js';

export interface DocSection {
  /** `docs/<id>` for a guide, `skills/<name>` for a skill. */
  docId: string;
  title: string;
  heading: string;
  text: string;
}

export interface DocHit {
  id: string;
  title: string;
  heading: string;
  excerpt: string;
  score: number;
  version: string;
}

export interface DocEntry {
  id: string;
  title: string;
  kind: 'doc' | 'skill';
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'how',
  'do',
  'i',
  'to',
  'a',
  'an',
  'of',
  'in',
  'on',
  'is',
  'it',
  'my',
  'with',
  'can',
  'what',
  'make',
  'use'
]);

function readIndex(): { version: string; docs: { id: string; title: string }[] } {
  const url = new URL('index.json', DOCS_DIR);
  if (!existsSync(url)) return { version: packageVersion(), docs: [] };
  return JSON.parse(readFileSync(url, 'utf8')) as {
    version: string;
    docs: { id: string; title: string }[];
  };
}

function skillNames(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/SKILL.md`, SKILLS_DIR))
    )
    .map((entry) => entry.name)
    .sort();
}

export function listDocs(): DocEntry[] {
  const docs: DocEntry[] = readIndex().docs.map((doc) => ({
    id: `docs/${doc.id}`,
    title: doc.title,
    kind: 'doc' as const
  }));
  for (const name of skillNames())
    docs.push({ id: `skills/${name}`, title: skillTitle(name), kind: 'skill' });
  return docs;
}

function skillTitle(name: string): string {
  const text = readDocText(`skills/${name}`);
  const match = text ? /^name:\s*(.+)$/m.exec(text) : null;
  return match?.[1]?.trim() ?? name;
}

/** The full text of a corpus document; ids are matched against the shipped list, never used as paths. */
export function readDocText(id: string): string | undefined {
  const known = listDocsRaw().find((entry) => entry === id);
  if (!known) return undefined;
  const url = known.startsWith('skills/')
    ? new URL(`${known.slice('skills/'.length)}/SKILL.md`, SKILLS_DIR)
    : new URL(`${known.slice('docs/'.length)}.md`, DOCS_DIR);
  try {
    return readFileSync(url, 'utf8');
  } catch {
    return undefined;
  }
}

function listDocsRaw(): string[] {
  return [
    ...readIndex().docs.map((doc) => `docs/${doc.id}`),
    ...skillNames().map((name) => `skills/${name}`)
  ];
}

export function sections(): DocSection[] {
  const out: DocSection[] = [];
  const titles = new Map(listDocs().map((entry) => [entry.id, entry.title]));
  for (const id of listDocsRaw()) {
    const text = readDocText(id) ?? '';
    const title = titles.get(id) ?? id;
    let heading = title;
    let buffer: string[] = [];
    let inFence = false;
    const flush = (): void => {
      const body = buffer.join('\n').trim();
      if (body.length > 0) out.push({ docId: id, title, heading, text: body });
      buffer = [];
    };
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) inFence = !inFence;
      const match = !inFence ? /^#{1,3}\s+(.+)$/.exec(line) : null;
      if (match?.[1]) {
        flush();
        heading = match[1].trim();
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return out;
}

function tokens(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9áéíóúñ]+/g) ?? [])].filter(
    (token) => token.length > 1 && !STOP.has(token)
  );
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (
    let i = haystack.indexOf(needle);
    i !== -1 && n < 50;
    i = haystack.indexOf(needle, i + needle.length)
  )
    n += 1;
  return n;
}

/** Keyword search over the version-matched corpus. Offline, deterministic, no network. */
export function searchDocs(query: string, limit = 5): DocHit[] {
  const words = tokens(query.slice(0, 300));
  if (words.length === 0) return [];
  const version = readIndex().version;
  const hits: DocHit[] = [];
  for (const section of sections()) {
    const body = section.text.toLowerCase();
    const heading = section.heading.toLowerCase();
    const title = section.title.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const word of words) {
      const inBody = count(body, word);
      const inHeading = count(heading, word);
      const inTitle = count(title, word);
      if (inBody + inHeading + inTitle > 0) matched += 1;
      score += inBody + inHeading * 6 + inTitle * 2;
    }
    if (matched === 0) continue;
    score *= 1 + matched / words.length;
    const first = Math.max(0, body.indexOf(words.find((word) => body.includes(word)) ?? ''));
    const start = Math.max(0, first - 120);
    hits.push({
      id: section.docId,
      title: section.title,
      heading: section.heading,
      excerpt: cleanText(section.text.slice(start, start + 600).replace(/\s+/g, ' '), 600),
      score: Math.round(score * 10) / 10,
      version
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(Math.max(limit, 1), 10));
}
