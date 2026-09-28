import { provideAppInitializer, type ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeAnalytics, provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })
    ),
    provideVoltTheme({ color: 'sage', style: 'soft' }),
    // No `authToken`: the staff session is the `forge_session` cookie (spec 054). A bearer kept in
    // `localStorage` outlived "Log out", because logout can only clear the cookie.
    provideForgeCms({ baseUrl: '/api/v1' }),
    // One-off cleanup for browsers that signed in before spec 071: nothing reads the old bearer any
    // more, but a stored token is still a credential a script on the page could take.
    provideAppInitializer(() => {
      try {
        localStorage.removeItem('forge-auth-token');
      } catch {
        // Storage unavailable (private mode, blocked): nothing was stored either.
      }
    }),
    // Forge Analytics (spec 057, experimental) — dogfooding this app as the vertical-slice target.
    provideForgeAnalytics({ enabled: true })
  ]
};
