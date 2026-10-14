import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** One file is never read beyond this many bytes (the project is untrusted input). */
export const MAX_FILE_BYTES = 256 * 1024;
/** All reads of one inspection together never exceed this. */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_LISTED = 80;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.angular',
  '.analog',
  '.output',
  '.wrangler'
]);

/**
 * A read-only, bounded view of ONE project directory.
 *
 * The reader is the single place that touches the filesystem. It exposes no "read this path" capability
 * to a tool caller: only the tools' own hard-coded relative paths go through it. Every access is checked
 * (relative, no `..`, regular file, size cap, real path still inside the project root), and nothing
 * outside the root, no `.env`, and no symlink escaping the root can be reached.
 */
export class ProjectReader {
  readonly root: string;
  private consumed = 0;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  /** Resolves `rel` to a real path inside the root, or `undefined`. */
  private resolve(rel: string): string | undefined {
    if (rel === '.') return this.root;
    if (rel.length === 0 || isAbsolute(rel) || rel.includes('\0')) return undefined;
    const parts = rel.split(/[\\/]/);
    if (parts.some((part) => part === '..' || part === '')) return undefined;
    const candidate = join(this.root, ...parts);
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      return undefined;
    }
    const inside = relative(this.root, real);
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      return undefined;
    }
    return real;
  }

  /** Whether a regular file or directory exists at `rel` (contents are not read). */
  exists(rel: string): boolean {
    const real = this.resolve(rel);
    return real !== undefined;
  }

  /** File text, or `undefined` when missing, not a regular file, too large, or over the total budget. */
  readText(rel: string): string | undefined {
    const real = this.resolve(rel);
    if (real === undefined) return undefined;
    try {
      const stat = lstatSync(real);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
      if (this.consumed + stat.size > MAX_TOTAL_BYTES) return undefined;
      this.consumed += stat.size;
      return readFileSync(real, 'utf8');
    } catch {
      return undefined;
    }
  }

  /** `JSON.parse` of a file, or `undefined` for missing/oversized/malformed content. */
  readJson(rel: string): unknown {
    const text = this.readText(rel);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** Names of the directory entries (bounded; never follows a link out of the root). */
  list(rel: string): { name: string; kind: 'file' | 'directory' }[] {
    const real = this.resolve(rel);
    if (real === undefined) return [];
    try {
      return readdirSync(real, { withFileTypes: true })
        .slice(0, MAX_LISTED)
        .flatMap((entry): { name: string; kind: 'file' | 'directory' }[] => {
          if (entry.isFile()) return [{ name: entry.name, kind: 'file' }];
          if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
            return [{ name: entry.name, kind: 'directory' }];
          }
          return [];
        });
    } catch {
      return [];
    }
  }

  /** Relative paths of files under `rel` whose name matches `pattern` (bounded depth and count). */
  find(rel: string, pattern: RegExp, maxDepth = 3, maxFiles = 60): string[] {
    const found: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (found.length >= maxFiles) return;
      for (const entry of this.list(dir)) {
        const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
        if (entry.kind === 'file' && pattern.test(entry.name)) found.push(path);
        else if (entry.kind === 'directory' && depth < maxDepth) walk(path, depth + 1);
        if (found.length >= maxFiles) return;
      }
    };
    walk(rel, 0);
    return found;
  }
}

/** Strips control characters (terminal escapes included) and caps the length of project-derived text. */
export function cleanText(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  let out = '';
  for (const char of text.slice(0, max * 2)) {
    const code = char.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (!control) out += char;
    if (out.length >= max) break;
  }
  return out;
}
