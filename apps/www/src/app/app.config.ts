import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideContent, withMarkdownRenderer } from '@analogjs/content';
import { provideVoltTheme } from '@voltui/components';
import {
  provideClientHydration,
  withEventReplay,
  withNoHttpTransferCache
} from '@angular/platform-browser';
import { provideForgeCms } from '@forge-cms/angular';
import { provideMovement } from 'angular-movement';
import { provideEtyma } from '@etyma/angular';
import { i18n } from './i18n/i18n';
import { provideLocaleSwitch } from './i18n/locale-routing';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideClientHydration(withNoHttpTransferCache(), withEventReplay()),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // `/docs/*` is long-form prose: land at the top on navigation, and honour `#heading` links.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })
    ),
    provideContent(withMarkdownRenderer()),
    // Spec 101: the URL decides the locale (see i18n/locale-routing.ts); catalogs are transferred to
    // the browser with the prerendered HTML, so hydration never fetches the locale again.
    provideEtyma(i18n),
    provideLocaleSwitch(),
    provideVoltTheme({ color: 'volt', style: 'sharp' }),
    provideMovement({ duration: '320ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }),
    // The reference transport policy (spec 075), stated even where it equals the defaults: same-origin
    // content and auth routes, the `forge_session` cookie (spec 054) and no Bearer token — so no other
    // origin can ever receive a credential from this app.
    provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })
  ]
};
