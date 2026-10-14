import { describe, expect, it } from 'vitest';
import { listDocs, readDocText, searchDocs } from './docs.js';
import { packageVersion } from './package-info.js';

describe('version-matched docs corpus', () => {
  it('ships the curated guides and every skill, and no historical spec', () => {
    const ids = listDocs().map((entry) => entry.id);
    for (const id of [
      'docs/quickstart',
      'docs/reference',
      'docs/matrices',
      'docs/support',
      'docs/limitations',
      'docs/migrating-to-1.0',
      'docs/analytics',
      'docs/uploads'
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids.filter((id) => id.startsWith('skills/')).sort()).toEqual([
      'skills/forgecms-admin',
      'skills/forgecms-analytics',
      'skills/forgecms-auth-access',
      'skills/forgecms-cloudflare',
      'skills/forgecms-content-modeling',
      'skills/forgecms-localization',
      'skills/forgecms-migrations-recovery',
      'skills/forgecms-setup'
    ]);
    expect(ids.some((id) => id.includes('spec'))).toBe(false);
  });

  it('answers "How do I make a localized Spanish/English title?" with the real localization guidance', () => {
    const hits = searchDocs('How do I make a localized Spanish/English title?', 5);
    expect(hits.length).toBeGreaterThan(0);
    const text = hits.map((hit) => hit.excerpt).join('\n');
    expect(
      hits.some((hit) => hit.id === 'skills/forgecms-localization' || hit.id === 'docs/collections')
    ).toBe(true);
    expect(text).toMatch(/localized: true/);
    expect(hits.every((hit) => hit.version === packageVersion())).toBe(true);
  });

  it('finds the Analytics recipe', () => {
    const hits = searchDocs('enable analytics in the admin dashboard', 5);
    expect(
      hits.some((hit) => hit.id === 'docs/analytics' || hit.id === 'skills/forgecms-analytics')
    ).toBe(true);
  });

  it('is deterministic, bounded and safe on odd input', () => {
    expect(searchDocs('')).toEqual([]);
    expect(searchDocs('the and of')).toEqual([]);
    expect(searchDocs('zzzzqqqq-nonexistent')).toEqual([]);
    expect(searchDocs('uploads', 99).length).toBeLessThanOrEqual(10);
    expect(searchDocs('uploads')).toEqual(searchDocs('uploads'));
    for (const hit of searchDocs('a'.repeat(10_000)))
      expect(hit.excerpt.length).toBeLessThanOrEqual(600);
  });

  it('serves only listed ids (an id is never a path)', () => {
    expect(readDocText('docs/quickstart')).toContain('Local API');
    for (const bad of [
      '../package',
      'docs/../../package',
      '/etc/passwd',
      'skills/../../x',
      'docs/nope'
    ]) {
      expect(readDocText(bad), bad).toBeUndefined();
    }
  });
});
