import { describe, expect, it } from 'vitest';
import {
  canLoadAnalytics,
  isPublicAnalyticsPath,
  sanitizeUmamiPageview,
  shouldShowAnalyticsChoices,
  umamiTrackerConfiguration
} from './site-analytics-consent.service';

describe('public analytics policy', () => {
  it('loads only after opt-in on the canonical production host and public routes', () => {
    expect(canLoadAnalytics('unset', 'forgecms.dev', '/')).toBe(false);
    expect(canLoadAnalytics('declined', 'forgecms.dev', '/')).toBe(false);
    expect(canLoadAnalytics('accepted', 'localhost', '/')).toBe(false);
    expect(canLoadAnalytics('accepted', '127.0.0.1', '/')).toBe(false);
    expect(canLoadAnalytics('accepted', 'preview.forgecms.dev', '/')).toBe(false);
    expect(canLoadAnalytics('accepted', 'forgecms.dev', '/admin/login')).toBe(false);
    expect(canLoadAnalytics('accepted', 'forgecms.dev', '/demo')).toBe(true);
  });

  it('allows only public route shapes', () => {
    for (const path of ['/', '/demo', '/docs/introduction', '/privacy']) {
      expect(isPublicAnalyticsPath(path)).toBe(true);
    }
    expect(isPublicAnalyticsPath('/admin/users')).toBe(false);
    expect(isPublicAnalyticsPath('/docs/quickstart/private')).toBe(false);
    expect(isPublicAnalyticsPath('/docs-evil')).toBe(false);
  });

  it('shows consent choices only on the production public site when there is no saved choice', () => {
    expect(shouldShowAnalyticsChoices('unset', 'forgecms.dev', '/')).toBe(true);
    expect(shouldShowAnalyticsChoices('accepted', 'forgecms.dev', '/')).toBe(false);
    expect(shouldShowAnalyticsChoices('declined', 'forgecms.dev', '/')).toBe(false);
    expect(shouldShowAnalyticsChoices('unset', 'localhost', '/')).toBe(false);
    expect(shouldShowAnalyticsChoices('unset', 'forgecms.dev', '/admin/login')).toBe(false);
  });

  it('configures the official tracker without credentials or custom events', () => {
    expect(umamiTrackerConfiguration()).toEqual({
      src: 'https://umami.andersseen.dev/script.js',
      websiteId: '95f4f3dd-9700-4985-9753-63fe142abbeb',
      domains: 'forgecms.dev',
      excludeSearch: 'true',
      excludeHash: 'true',
      doNotTrack: 'true',
      beforeSend: '__forgeCmsUmamiBeforeSend'
    });
    expect(JSON.stringify(umamiTrackerConfiguration())).not.toMatch(
      /token|password|secret|api.?key/i
    );
  });

  it('forwards only the website id and public path for pageviews', () => {
    expect(
      sanitizeUmamiPageview('pageview', {
        url: 'https://forgecms.dev/docs/quickstart?token=private#secret',
        title: 'Sensitive title',
        referrer: 'https://private.example/path?email=secret',
        screen: '1920x1080'
      })
    ).toEqual({
      website: '95f4f3dd-9700-4985-9753-63fe142abbeb',
      url: '/docs/quickstart'
    });
  });

  it('rejects custom events, invalid URLs, private routes, and other hostnames', () => {
    expect(sanitizeUmamiPageview('event', { url: 'https://forgecms.dev/' })).toBe(false);
    expect(sanitizeUmamiPageview('pageview', { url: 'not a url %' })).toBe(false);
    expect(sanitizeUmamiPageview('pageview', { url: 'https://forgecms.dev/admin' })).toBe(false);
    expect(sanitizeUmamiPageview('pageview', { url: 'https://elsewhere.example/' })).toBe(false);
  });
});
