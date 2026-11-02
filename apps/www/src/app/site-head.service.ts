import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import type { ActivatedRouteSnapshot } from '@angular/router';
import { CANONICAL_ORIGIN, SOCIAL_IMAGE_PATH } from './site-config.mjs';
import { canonicalUrl } from './site-meta';
import type { SiteMessageKey } from './i18n/i18n';
import { SiteLocaleService } from './i18n/site-locale.service';
import {
  LOCALE_META,
  SOURCE_LOCALE,
  localizePath,
  stripLocale,
  type SiteLocale
} from './i18n/site-locales.mjs';

/** Route data for an indexable page whose title and description come from the catalog. */
export interface SeoRouteData {
  readonly titleKey: SiteMessageKey;
  readonly descriptionKey: SiteMessageKey;
}

const HREFLANG_ATTR = 'data-forge-hreflang';

/**
 * The single owner of the localized `<head>` (spec 101, extending spec 075): `<html lang>`, title,
 * description, canonical, Open Graph / Twitter tags and `hreflang` alternates. Etyma's Angular package
 * leaves the head alone, and `@etyma/analog`'s SEO is not used, so nothing else writes these tags.
 *
 * Alternates name only locales the page really exists in (`SiteLocaleService.localesOf`): a docs
 * article translated into Spanish only gets `en` + `es` + `x-default`, never a `uk` URL. Elements are
 * updated in place and tagged, so the prerendered head and the hydrated one never duplicate.
 */
@Injectable({ providedIn: 'root' })
export class SiteHeadService {
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly site = inject(SiteLocaleService);

  /** Called after every navigation with the deepest activated route. */
  update(url: string, route: ActivatedRouteSnapshot): void {
    const locale = this.site.locale();
    const { htmlLang, ogLocale } = LOCALE_META[locale];
    const root = this.document.documentElement;
    root.setAttribute('lang', htmlLang);
    root.setAttribute('dir', this.site.i18n.direction());

    const seo = route.data['seo'] as SeoRouteData | undefined;
    if (seo) {
      this.title.setTitle(this.site.i18n.t(seo.titleKey));
      this.meta.updateTag({ name: 'description', content: this.site.i18n.t(seo.descriptionKey) });
    } else if (!stripLocale(url).startsWith('/docs/')) {
      // Docs articles set their own; anything else must not keep the previous page's description.
      this.meta.updateTag({
        name: 'description',
        content: this.site.i18n.t('seo.landing.description')
      });
    }

    const available = this.site.localesOf(url);
    const indexable = available.includes(locale);
    const path = stripLocale(new URL(url, CANONICAL_ORIGIN).pathname);
    // A page that does not exist in this locale (an untranslated docs URL reached in-app) points
    // search engines at the English original instead of claiming to be a translation.
    const canonical = canonicalUrl(indexable ? url : localizePath(path, SOURCE_LOCALE));
    this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
    this.setAlternates(indexable ? available : [], path);

    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:locale', content: ogLocale });
    for (const tag of this.meta.getTags('property="og:locale:alternate"')) {
      this.meta.removeTagElement(tag);
    }
    if (indexable) {
      for (const other of available.filter((l) => l !== locale)) {
        this.meta.addTag({ property: 'og:locale:alternate', content: LOCALE_META[other].ogLocale });
      }
    }
    this.syncSharing();
    this.meta.updateTag({
      property: 'og:image:alt',
      content: this.site.i18n.t('seo.socialImageAlt')
    });

    const robots = route.data['robots'];
    if (typeof robots === 'string') this.meta.updateTag({ name: 'robots', content: robots });
    else if (!indexable) this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    else this.meta.removeTag('name="robots"');
  }

  /** Copies the current title and description into the Open Graph and Twitter tags. */
  syncSharing(): void {
    const title = this.document.title;
    const description = this.meta.getTag('name="description"')?.content ?? '';
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    const image = `${CANONICAL_ORIGIN}${SOCIAL_IMAGE_PATH}`;
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ name: 'twitter:image', content: image });
  }

  /** One `<link rel="alternate" hreflang>` per existing locale, plus `x-default` → English. */
  private setAlternates(locales: readonly SiteLocale[], path: string): void {
    const head = this.document.head;
    for (const link of Array.from(head.querySelectorAll(`link[${HREFLANG_ATTR}]`))) link.remove();
    if (locales.length < 2) return;
    const entries = [
      ...locales.map((locale) => [locale, localizePath(path, locale)] as const),
      ['x-default', localizePath(path, SOURCE_LOCALE)] as const
    ];
    for (const [hreflang, href] of entries) {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', hreflang);
      link.setAttribute('href', canonicalUrl(href));
      link.setAttribute(HREFLANG_ATTR, '');
      head.appendChild(link);
    }
  }
}
