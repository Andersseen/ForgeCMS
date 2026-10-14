import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, ProjectReader, cleanText } from './project-reader.js';
import { makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});
const project = (files: Record<string, string | object>) => {
  const made = makeProject(files);
  cleanups.push(made.cleanup);
  return made;
};

describe('ProjectReader', () => {
  it('reads a file inside the root', () => {
    const { root } = project({ 'package.json': { name: 'x' } });
    expect(new ProjectReader(root).readJson('package.json')).toEqual({ name: 'x' });
  });

  it('refuses traversal, absolute paths and empty segments', () => {
    const outside = project({ 'secret.txt': 'TOP SECRET' });
    const { root } = project({ 'a.txt': 'ok' });
    const reader = new ProjectReader(root);
    for (const attempt of [
      '../secret.txt',
      '../../.env',
      'a/../../secret.txt',
      join(outside.root, 'secret.txt'),
      '/etc/passwd',
      '',
      './a.txt//',
      'a.txt\0.png'
    ]) {
      expect(reader.readText(attempt), attempt).toBeUndefined();
      expect(reader.exists(attempt), attempt).toBe(false);
    }
  });

  it('does not follow a symlink that leaves the root', () => {
    const outside = project({ 'secret.txt': 'TOP SECRET' });
    const { root } = project({ 'ok.txt': 'fine' });
    symlinkSync(join(outside.root, 'secret.txt'), join(root, 'link.txt'));
    symlinkSync(outside.root, join(root, 'dir-link'));
    const reader = new ProjectReader(root);
    expect(reader.readText('link.txt')).toBeUndefined();
    expect(reader.readText('dir-link/secret.txt')).toBeUndefined();
    expect(reader.list('dir-link')).toEqual([]);
    expect(reader.readText('ok.txt')).toBe('fine');
  });

  it('follows a symlink that stays inside the root (pnpm-style node_modules)', () => {
    const { root } = project({ 'real/package.json': { version: '1.0.0' } });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(root, 'real'), join(root, 'node_modules', 'pkg'));
    expect(new ProjectReader(root).readJson('node_modules/pkg/package.json')).toEqual({
      version: '1.0.0'
    });
  });

  it('refuses oversized files and directories as files, and bounds listings', () => {
    const { root } = project({ 'dir/x.txt': 'x' });
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(MAX_FILE_BYTES + 1));
    const reader = new ProjectReader(root);
    expect(reader.readText('big.txt')).toBeUndefined();
    expect(reader.readText('dir')).toBeUndefined();
    expect(
      reader
        .list('.')
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['big.txt', 'dir']);
  });

  it('skips node_modules/dist/.git when walking', () => {
    const { root } = project({
      'src/a.ts': '',
      'node_modules/x/a.ts': '',
      'dist/a.ts': '',
      '.git/a.ts': ''
    });
    expect(new ProjectReader(root).find('.', /\.ts$/)).toEqual(['src/a.ts']);
  });

  it('returns undefined for malformed JSON instead of throwing', () => {
    const { root } = project({ 'package.json': '{not json' });
    expect(new ProjectReader(root).readJson('package.json')).toBeUndefined();
  });
});

describe('cleanText', () => {
  it('removes control characters and terminal escapes and caps the length', () => {
    expect(cleanText('a\u001b[31mred\u0007\u0000b\n\r\t')).toBe('a[31mredb');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(undefined)).toBe('');
  });
});
