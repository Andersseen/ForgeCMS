import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_SCHEMA,
  sanitizeCountry,
  sanitizePathname,
  sanitizeReferrerHost,
  sanitizeSiteId,
  toPageviewDataPoint
} from './analytics-schema.js';

describe('sanitizePathname', () => {
  it('strips a query string and fragment', () => {
    expect(sanitizePathname('/foo?x=1#y')).toBe('/foo');
  });

  it('ensures a leading slash', () => {
    expect(sanitizePathname('foo/bar')).toBe('/foo/bar');
  });

  it('falls back to / for empty or non-string input', () => {
    expect(sanitizePathname('')).toBe('/');
    expect(sanitizePathname(undefined)).toBe('/');
    expect(sanitizePathname(42)).toBe('/');
  });

  it('caps length at 256 characters', () => {
    const long = '/' + 'a'.repeat(400);
    expect(sanitizePathname(long).length).toBe(256);
  });
});

describe('sanitizeReferrerHost', () => {
  it('reduces a full URL to its hostname', () => {
    expect(sanitizeReferrerHost('https://www.google.com/search?q=x')).toBe('www.google.com');
  });

  it('returns empty string for same-origin referrers', () => {
    expect(sanitizeReferrerHost('https://example.com/other-page', 'example.com')).toBe('');
  });

  it('returns empty string for missing or unparseable input', () => {
    expect(sanitizeReferrerHost(undefined)).toBe('');
    expect(sanitizeReferrerHost('')).toBe('');
    expect(sanitizeReferrerHost('not a url')).toBe('');
  });
});

describe('sanitizeCountry', () => {
  it('uppercases a valid 2-letter code', () => {
    expect(sanitizeCountry('us')).toBe('US');
  });

  it('rejects unresolved/Tor markers and malformed input', () => {
    expect(sanitizeCountry('XX')).toBe('');
    expect(sanitizeCountry('T1')).toBe('');
    expect(sanitizeCountry('USA')).toBe('');
    expect(sanitizeCountry(undefined)).toBe('');
  });
});

describe('sanitizeSiteId', () => {
  it('falls back to "default"', () => {
    expect(sanitizeSiteId(undefined)).toBe('default');
    expect(sanitizeSiteId('')).toBe('default');
  });

  it('passes through a real value', () => {
    expect(sanitizeSiteId('demo-aesthetics')).toBe('demo-aesthetics');
  });

  it('strips characters outside the safe identifier charset', () => {
    expect(sanitizeSiteId("o'brien; DROP TABLE x")).toBe('obrienDROPTABLEx');
  });

  it('falls back to "default" when nothing safe remains', () => {
    expect(sanitizeSiteId("'; @#$%^&*()")).toBe('default');
  });
});

describe('toPageviewDataPoint', () => {
  it('places every field at its documented schema position', () => {
    const point = toPageviewDataPoint({
      siteId: 'site-1',
      pathname: '/about',
      referrerHost: 'google.com',
      country: 'US'
    });

    expect(point.indexes?.[ANALYTICS_SCHEMA.index.siteId - 1]).toBe('site-1');
    expect(point.blobs?.[ANALYTICS_SCHEMA.blob.eventType - 1]).toBe('pageview');
    expect(point.blobs?.[ANALYTICS_SCHEMA.blob.pathname - 1]).toBe('/about');
    expect(point.blobs?.[ANALYTICS_SCHEMA.blob.referrerHost - 1]).toBe('google.com');
    expect(point.blobs?.[ANALYTICS_SCHEMA.blob.country - 1]).toBe('US');
    expect(point.doubles?.[ANALYTICS_SCHEMA.double.count - 1]).toBe(1);
  });
});
