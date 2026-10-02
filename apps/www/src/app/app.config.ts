import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideContent, withMarkdownRenderer } from '@analogjs/content';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { provideMovement } from 'angular-movement';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // `/docs/*` is long-form prose: land at the top on navigation, and honour `#heading` links.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })
    ),
    provideContent(withMarkdownRenderer()),
    provideVoltTheme({ color: 'volt', style: 'sharp' }),
    provideMovement({ duration: '320ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }),
    // The reference transport policy (spec 075), stated even where it equals the defaults: same-origin
    // content and auth routes, the `forge_session` cookie (spec 054) and no Bearer token — so no other
    // origin can ever receive a credential from this app.
    provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })
  ]
};
