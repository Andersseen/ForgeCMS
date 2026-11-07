import '@angular/platform-server/init';
import { render } from '@analogjs/router/server';
import { REQUEST as ANALOG_REQUEST } from '@analogjs/router/tokens';
import { REQUEST_CONTEXT, inject } from '@angular/core';
import { withStrataSsrFailureContract } from '@strata-sc/server-components/ssr';

import { App } from './app/app';
import { config } from './app/app.config.server';
import { EDITORIAL_ENV_KEY } from './app/cms/request-context';
import type { EditorialRequestContext } from './app/cms/request-context';
import { nodeEnv } from './app/cms/runtime';
import type { EditorialEnv } from './app/cms/runtime';

// SC-SSR-FAILURE, both halves: this wrapper around the REAL Angular render turns a marked or rejected
// buffered render into a generic HTTP 500 (no-store); the ErrorHandler half is in app.config.server.ts.
export default withStrataSsrFailureContract(
  render(App, config, [
    {
      provide: REQUEST_CONTEXT,
      useFactory: (): EditorialRequestContext => {
        const request = inject(ANALOG_REQUEST);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(name, value);
        }
        const cloudflareEnv = (request as unknown as Record<symbol, EditorialEnv | undefined>)[
          EDITORIAL_ENV_KEY
        ];
        return { headers, env: cloudflareEnv ?? nodeEnv() };
      }
    }
  ])
);
