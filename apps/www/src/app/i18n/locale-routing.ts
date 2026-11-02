import { inject, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import {
  Router,
  type CanActivateFn,
  type CanMatchFn,
  type Route,
  type Routes,
  type UrlMatcher
} from '@angular/router';
import { ETYMA_LOCALE_SWITCH, EtymaI18n } from '@etyma/angular';
import type { Locale } from '@etyma/core';
import { isPrefixedLocale, isSiteLocale, localizePath, SOURCE_LOCALE } from './site-locales.mjs';

/**
 * Locale-prefixed routing for the explicit Angular route tree (spec 101).
 *
 * `@etyma/analog`'s `withLocalizedRoutes()` targets Analog's file router (and Analog ≥ 2.6); this site
 * declares its routes, so it uses the extension points `@etyma/angular` documents for a custom router
 * integration instead: a guard that `activate()`s the URL's locale before the page renders (so the
 * prerendered HTML is already translated and hydration reuses the transferred catalog), and an
 * `ETYMA_LOCALE_SWITCH` that makes `setLocale()` a navigation. One `Routes` array serves every locale.
 */

export const LOCALE_PARAM = 'locale';

/** Only `/es/...` and `/uk/...` reach the prefixed branch; `/fr` or `/demo` never become a locale. */
const prefixedLocale: CanMatchFn = (_route, segments) => isPrefixedLocale(segments[0]?.path);

/** Loads and activates the URL's locale before the page renders (shared catalog loads are deduped). */
function activate(locale: Locale): Promise<true> {
  return inject(EtymaI18n)
    .activate(locale)
    .then(() => true);
}

const activateUrlLocale: CanActivateFn = (route) =>
  activate(route.paramMap.get(LOCALE_PARAM) ?? '');
const activateSourceLocale: CanActivateFn = () => activate(SOURCE_LOCALE);

/** `/en`, `/en/demo`, `/en/docs/x` → the unprefixed URL; the source locale has no prefix. */
const sourcePrefix: UrlMatcher = (segments) =>
  segments[0]?.path === SOURCE_LOCALE ? { consumed: segments } : null;

const sourcePrefixRedirect: Route = {
  matcher: sourcePrefix,
  redirectTo: ({ url, queryParams, fragment }) =>
    inject(Router).createUrlTree(['/', ...url.slice(1).map((segment) => segment.path)], {
      queryParams,
      ...(fragment !== null && { fragment })
    })
};

/**
 * The full route tree: `/en/*` redirects, `/:locale/*` (es, uk) and the unprefixed English branch
 * share `pages`, and `outside` (admin) stays English-only between them so `/admin` is never read as
 * a page of the English branch's catch-all.
 */
export function localizedRoutes(pages: Routes, outside: Routes): Routes {
  return [
    sourcePrefixRedirect,
    {
      path: `:${LOCALE_PARAM}`,
      canMatch: [prefixedLocale],
      canActivate: [activateUrlLocale],
      children: pages
    },
    ...outside.map((route) => ({
      ...route,
      canActivate: [activateSourceLocale, ...(route.canActivate ?? [])]
    })),
    { path: '', canActivate: [activateSourceLocale], children: pages }
  ];
}

/** `setLocale(locale)` navigates to the current page in `locale`, keeping query and fragment. */
export function provideLocaleSwitch(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ETYMA_LOCALE_SWITCH,
      useFactory: () => {
        const router = inject(Router);
        return async (locale: Locale): Promise<void> => {
          if (isSiteLocale(locale)) await router.navigateByUrl(localizePath(router.url, locale));
        };
      }
    }
  ]);
}
