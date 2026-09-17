import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { FORGE_ANALYTICS_CONFIG } from './analytics-config.js';

/**
 * A minimal first-party pageview tracker: one send on initial load, one more on every SPA navigation
 * whose pathname actually changed. No `rxjs` import — `Router.events.subscribe` is used directly
 * rather than `.pipe(filter(...))`, since this package otherwise has zero workspace/rxjs dependencies.
 *
 * Sends the minimum payload (`pathname`, optionally `referrer`) and never opts in to credentials: the
 * `fetch` fallback passes `credentials: 'omit'` explicitly. `sendBeacon` (the primary path) always
 * carries same-origin cookies per the browser's own beacon semantics — the collector route never reads
 * or stores them either way, so this doesn't leak anything, but it's not literally "no cookies sent."
 */
@Injectable({ providedIn: 'root' })
export class ForgeAnalyticsTracker {
  private readonly config = inject(FORGE_ANALYTICS_CONFIG, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private lastPathname: string | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    this.track(location.pathname);
    this.router?.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.track(location.pathname);
      }
    });
  }

  private get endpoint(): string {
    return this.config?.endpoint ?? '/api/analytics/collect';
  }

  /** No-ops when the pathname hasn't changed, so a redundant `NavigationEnd` never double-counts. */
  private track(pathname: string): void {
    if (pathname === this.lastPathname) return;
    // `document.referrer` is fixed for the whole browser session — it never changes on an in-app SPA
    // navigation, so only the very first pageview (the one that actually arrived from elsewhere) sends
    // it. Every navigation after that would otherwise re-report the entry referrer as if each page were
    // freshly arrived-at from it.
    const isFirstPageview = this.lastPathname === null;
    this.lastPathname = pathname;

    const referrer = isFirstPageview && typeof document !== 'undefined' ? document.referrer : '';
    const payload: { pathname: string; referrer?: string } = {
      pathname,
      ...(referrer && { referrer })
    };
    this.send(JSON.stringify(payload));
  }

  private send(body: string): void {
    const beaconSent =
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }));

    if (!beaconSent) {
      void fetch(this.endpoint, {
        method: 'POST',
        keepalive: true,
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body
      }).catch(() => {
        // Best-effort — a dropped pageview must never surface to the visitor.
      });
    }
  }
}
