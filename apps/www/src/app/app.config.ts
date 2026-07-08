import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    provideForgeCms({
      baseUrl: '/api/v1',
      authToken: () => localStorage.getItem('forge-auth-token')
    })
  ]
};
