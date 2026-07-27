import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideContent, withMarkdownRenderer } from '@analogjs/content';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withComponentInputBinding(),
      // `/docs/*` is long-form prose: land at the top on navigation, and honour `#heading` links.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })
    ),
    provideContent(withMarkdownRenderer()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    provideForgeCms({
      baseUrl: '/api/v1',
      authToken: () => localStorage.getItem('forge-auth-token')
    })
  ]
};
