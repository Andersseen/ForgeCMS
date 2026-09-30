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
    // No `authToken` here: the browser session is cookie-based (spec 054) — `CmsApiService` sends
    // `credentials: 'include'` on every request, and the `forge_session` cookie does the rest.
    provideForgeCms({ baseUrl: '/api/v1' })
  ]
};
