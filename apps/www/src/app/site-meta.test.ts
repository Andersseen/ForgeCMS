import { describe, expect, it } from 'vitest';
import { canonicalUrl } from './site-meta';

describe('canonicalUrl', () => {
  it('uses the canonical origin and drops queries and fragments', () => {
    expect(
      canonicalUrl('https://forge-cms.pages.dev/docs/quickstart/?utm_source=launch#install')
    ).toBe('https://forgecms.dev/docs/quickstart');
  });

  it('normalizes root and trailing slashes', () => {
    expect(canonicalUrl('/')).toBe('https://forgecms.dev/');
    expect(canonicalUrl('/demo///')).toBe('https://forgecms.dev/demo');
  });
});
