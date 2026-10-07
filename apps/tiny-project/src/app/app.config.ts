import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withNoHttpTransferCache } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Hydrate the server-rendered DOM instead of replacing it (spec 080). Forge uses its own fetch
    // transport, not HttpClient, so Angular's HttpClient transfer cache has nothing to do here;
    // public Forge reads opt in per resource with `{ transfer: 'public' }`.
    provideClientHydration(withNoHttpTransferCache()),
    provideRouter(routes, withComponentInputBinding()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    // No `authToken` here: the browser session is the cookie-first session from spec 054 —
    // `CmsApiService` sends `credentials: 'include'` on every request and `forge_session` does the
    // rest. Nothing in this app ever touches `localStorage` for auth.
    provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })
  ]
};
