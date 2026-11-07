import { mergeApplicationConfig } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { RESPONSE } from '@analogjs/router/tokens';
import { provideServerRendering } from '@angular/platform-server';
import { provideStrataSsrFailureHandler } from '@strata-sc/server-components/ssr';

import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    // SC-SSR-FAILURE ErrorHandler half: marks this request's Analog RESPONSE on an unexpected render error.
    provideStrataSsrFailureHandler(RESPONSE)
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
