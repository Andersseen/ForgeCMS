import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';
import { AUTH_TOKEN_KEY } from './auth-token';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })
    ),
    provideVoltTheme({ color: 'sage', style: 'soft' }),
    provideForgeCms({
      baseUrl: '/api/v1',
      authToken: () => localStorage.getItem(AUTH_TOKEN_KEY)
    })
  ]
};
