import { DOCUMENT, DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

const CONSENT_KEY = 'forgecms-analytics-consent';
const TRACKER_URL = 'https://umami.andersseen.dev/script.js';
const WEBSITE_ID = '95f4f3dd-9700-4985-9753-63fe142abbeb';
const PRODUCTION_HOST = 'forgecms.dev';

export function umamiTrackerConfiguration(): Readonly<{
  src: string;
  websiteId: string;
  domains: string;
  excludeSearch: 'true';
  excludeHash: 'true';
  doNotTrack: 'true';
  beforeSend: '__forgeCmsUmamiBeforeSend';
}> {
  return {
    src: TRACKER_URL,
    websiteId: WEBSITE_ID,
    domains: PRODUCTION_HOST,
    excludeSearch: 'true',
    excludeHash: 'true',
    doNotTrack: 'true',
    beforeSend: '__forgeCmsUmamiBeforeSend'
  };
}

export type AnalyticsConsent = 'unset' | 'accepted' | 'declined';

type UmamiWindow = Window & {
  __forgeCmsAnalyticsConsent?: boolean;
  __forgeCmsUmamiBeforeSend?: (type: string, payload: unknown) => unknown | false;
};

export function isPublicAnalyticsPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return (
    path === '/' ||
    path === '/demo' ||
    path === '/docs' ||
    /^\/docs\/[a-z0-9-]+$/i.test(path) ||
    path === '/privacy'
  );
}

export function canLoadAnalytics(
  consent: AnalyticsConsent,
  hostname: string,
  pathname: string
): boolean {
  return consent === 'accepted' && hostname === PRODUCTION_HOST && isPublicAnalyticsPath(pathname);
}

export function shouldShowAnalyticsChoices(
  consent: AnalyticsConsent,
  hostname: string,
  pathname: string
): boolean {
  return consent === 'unset' && hostname === PRODUCTION_HOST && isPublicAnalyticsPath(pathname);
}

export function sanitizeUmamiPageview(
  type: string,
  payload: unknown,
  productionHost = PRODUCTION_HOST
): { website: string; url: string } | false {
  if (type !== 'pageview' || typeof payload !== 'object' || payload === null) return false;
  const candidate = (payload as Record<string, unknown>)['url'];
  if (typeof candidate !== 'string') return false;

  let url: URL;
  try {
    url = new URL(candidate, `https://${productionHost}`);
  } catch {
    return false;
  }
  if (url.hostname !== productionHost || !isPublicAnalyticsPath(url.pathname)) return false;

  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  return { website: WEBSITE_ID, url: path };
}

@Injectable({ providedIn: 'root' })
export class SiteAnalyticsConsentService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly view = this.browser ? this.document.defaultView : null;
  private trackerRequested = false;
  readonly consent = signal<AnalyticsConsent>(this.readConsent());

  constructor() {
    if (!this.browser || !this.view) return;

    this.viewAsUmamiWindow().__forgeCmsAnalyticsConsent = this.consent() === 'accepted';
    if (this.consent() === 'accepted') this.loadTrackerWhenEligible();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe(() => this.loadTrackerWhenEligible());
  }

  accept(): void {
    this.setConsent('accepted');
    this.loadTrackerWhenEligible();
  }

  decline(): void {
    this.setConsent('declined');
  }

  revoke(): void {
    this.setConsent('declined');
  }

  private setConsent(consent: Exclude<AnalyticsConsent, 'unset'>): void {
    this.consent.set(consent);
    if (this.view) {
      try {
        this.view.localStorage.setItem(CONSENT_KEY, consent);
      } catch {
        // The in-memory choice still applies for this page session.
      }
      this.viewAsUmamiWindow().__forgeCmsAnalyticsConsent = consent === 'accepted';
    }
  }

  private readConsent(): AnalyticsConsent {
    if (!this.browser || !this.view) return 'unset';
    try {
      const value = this.view.localStorage.getItem(CONSENT_KEY);
      return value === 'accepted' || value === 'declined' ? value : 'unset';
    } catch {
      return 'unset';
    }
  }

  private loadTrackerWhenEligible(): void {
    if (
      !this.view ||
      !canLoadAnalytics(this.consent(), this.view.location.hostname, this.view.location.pathname) ||
      this.trackerRequested
    ) {
      return;
    }

    const script = this.document.createElement('script');
    const umamiWindow = this.viewAsUmamiWindow();
    umamiWindow.__forgeCmsAnalyticsConsent = true;
    umamiWindow.__forgeCmsUmamiBeforeSend = (type, payload) => {
      if (!umamiWindow.__forgeCmsAnalyticsConsent) return false;
      return sanitizeUmamiPageview(type, payload);
    };

    const configuration = umamiTrackerConfiguration();
    script.src = configuration.src;
    script.async = true;
    script.dataset['websiteId'] = configuration.websiteId;
    script.dataset['domains'] = configuration.domains;
    script.dataset['excludeSearch'] = configuration.excludeSearch;
    script.dataset['excludeHash'] = configuration.excludeHash;
    script.dataset['doNotTrack'] = configuration.doNotTrack;
    script.dataset['beforeSend'] = configuration.beforeSend;
    script.onerror = () => script.remove();
    this.trackerRequested = true;
    this.document.head.append(script);
  }

  private viewAsUmamiWindow(): UmamiWindow {
    return this.view as UmamiWindow;
  }
}
