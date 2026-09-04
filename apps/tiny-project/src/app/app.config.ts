import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    // No `authToken` here: the browser session is the cookie-first session from spec 054 —
    // `CmsApiService` sends `credentials: 'include'` on every request and `forge_session` does the
    // rest. Nothing in this app ever touches `localStorage` for auth.
    provideForgeCms({ baseUrl: '/api/v1' })
  ]
};
