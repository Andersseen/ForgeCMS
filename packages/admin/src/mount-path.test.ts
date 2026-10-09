import { describe, expect, it } from 'vitest';
import { isUnderPath, normalizeAdminBasePath, parseAdminBasePath } from './mount-path.js';

describe('admin mount root (spec 087)', () => {
  it('normalises leading/trailing slashes and nested segments', () => {
    expect(parseAdminBasePath('/studio')).toBe('/studio');
    expect(parseAdminBasePath('/studio/')).toBe('/studio');
    expect(parseAdminBasePath(' /ops/cms/ ')).toBe('/ops/cms');
  });

  it('rejects anything that is not a same-app absolute path', () => {
    for (const bad of [
      '',
      '/',
      'studio',
      '//evil.example',
      'https://evil.example',
      '/a//b',
      '/a/../b',
      '/a/./b',
      '/a?x=1',
      '/a#h',
      '/a\\b',
      '/a b',
      '/a\u0000'
    ]) {
      expect(parseAdminBasePath(bad), bad).toBeNull();
    }
    expect(parseAdminBasePath(undefined)).toBeNull();
  });

  it('falls back to /admin', () => {
    expect(normalizeAdminBasePath(undefined)).toBe('/admin');
    expect(normalizeAdminBasePath('https://evil.example')).toBe('/admin');
    expect(normalizeAdminBasePath('/studio')).toBe('/studio');
  });

  it('matches the root exactly and children by segment only', () => {
    expect(isUnderPath('/studio', '/studio')).toBe(true);
    expect(isUnderPath('/studio/users', '/studio')).toBe(true);
    expect(isUnderPath('/studio-evil', '/studio')).toBe(false);
    expect(isUnderPath('/admin', '/studio')).toBe(false);
  });
});
