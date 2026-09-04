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
