import { provideFileRouter } from '@analogjs/router';
import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideSkewRecovery, provideStrataHydrationObserver } from '@strata-sc/server-components';
import type { StrataHydrationObservation } from '@strata-sc/server-components';

export const appConfig: ApplicationConfig = {
  providers: [
    provideFileRouter(),
    // Event replay: a click on an island before hydration finishes is replayed once, not lost or doubled.
    provideClientHydration(withEventReplay()),
    // SC-BUILD-IDENTITY: a document and a script from different deployments are never hydrated together;
    // one bounded reload recovers the new build.
    provideSkewRecovery({ reload: true }),
    // Privacy-safe commit observations (selector, outcome, counts, timing; never props or markup), kept on
    // the page for operational checks and the browser qualification.
    provideStrataHydrationObserver((observation: StrataHydrationObservation) => {
      const sink = globalThis as { __editorialHydration?: StrataHydrationObservation[] };
      (sink.__editorialHydration ??= []).push(observation);
    })
  ]
};
