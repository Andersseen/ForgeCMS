import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // The admin reads its route data through component inputs: this feature is required.
    provideRouter(routes, withComponentInputBinding()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    // The only place that names the APIs. These are the defaults, written out for clarity.
    provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })
  ]
};
