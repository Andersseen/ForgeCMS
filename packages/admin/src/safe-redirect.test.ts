import { describe, expect, it } from 'vitest';
import { safeAdminRedirect } from './safe-redirect.js';

describe('safeAdminRedirect', () => {
  it('keeps valid admin return URLs including query and hash', () => {
    expect(safeAdminRedirect('/admin/collections/posts?status=draft#top')).toBe(
      '/admin/collections/posts?status=draft#top'
    );
  });

  it('falls back for empty or non-admin paths', () => {
    expect(safeAdminRedirect(null)).toBe('/admin');
    expect(safeAdminRedirect('')).toBe('/admin');
    expect(safeAdminRedirect('/docs')).toBe('/admin');
    expect(safeAdminRedirect('/administrator')).toBe('/admin');
  });

  it('falls back for external or protocol-relative values', () => {
    expect(safeAdminRedirect('https://example.com/admin')).toBe('/admin');
    expect(safeAdminRedirect('//example.com/admin')).toBe('/admin');
    expect(safeAdminRedirect('/\\example.com/admin')).toBe('/admin');
  });

  it('uses the provided fallback when rejecting unsafe values', () => {
    expect(safeAdminRedirect('javascript:alert(1)', '/admin/login')).toBe('/admin/login');
  });

  it('can normalize an unsafe configured fallback before using it elsewhere', () => {
    const fallback = safeAdminRedirect('', '/admin');
    expect(safeAdminRedirect('https://example.com/admin', fallback)).toBe('/admin');
  });
});

describe('safeAdminRedirect under a custom mount root (spec 087)', () => {
  const root = '/studio';
  const run = (value: string) => safeAdminRedirect(value, '/studio', root);

  it('keeps targets under the configured root', () => {
    for (const ok of [
      '/studio',
      '/studio/collections',
      '/studio/collections/posts?page=2',
      '/studio/collections/posts/abc#field'
    ]) {
      expect(run(ok)).toBe(ok);
    }
  });

  it('refuses everything outside the root, including /admin and sibling prefixes', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      '/studio\\evil',
      '/studio/\u0000x',
      '/admin/collections',
      '/public-page',
      '/studio-evil',
      '/studio/../admin'
    ]) {
      expect(run(bad), bad).toBe('/studio');
    }
  });

  it('supports nested roots and leaves /admin the default', () => {
    expect(safeAdminRedirect('/ops/cms/users', '/ops/cms', '/ops/cms')).toBe('/ops/cms/users');
    expect(safeAdminRedirect('/ops/other', '/ops/cms', '/ops/cms')).toBe('/ops/cms');
    expect(safeAdminRedirect('/ops', '/ops/cms', '/ops/cms')).toBe('/ops/cms');
    expect(safeAdminRedirect('/admin/x')).toBe('/admin/x');
  });
});
