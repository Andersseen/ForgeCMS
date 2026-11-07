import { provideFileRouter } from '@analogjs/router';
import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideSkewRecovery } from '@strata-sc/server-components';

export const appConfig: ApplicationConfig = {
  providers: [
    provideFileRouter(),
    // Event replay: a click on an island before hydration finishes is replayed once, not lost or doubled.
    provideClientHydration(withEventReplay()),
    // SC-BUILD-IDENTITY: a document and a script from different deployments are never hydrated together;
    // one bounded reload recovers the new build.
    provideSkewRecovery({ reload: true })
  ]
};
