import type { H3Event } from 'h3';

import { EDITORIAL_ENV_KEY } from '../../app/cms/request-context';

interface NitroHooks {
  readonly hooks: { hook(name: 'request', handler: (event: H3Event) => void): unknown };
}

/** See `EDITORIAL_ENV_KEY`: hands the Cloudflare bindings of this request to the SSR render of this request. */
export default function requestEnvPlugin(nitroApp: NitroHooks): void {
  nitroApp.hooks.hook('request', (event) => {
    const env = (event.context['cloudflare'] as { env?: unknown } | undefined)?.env;
    const request = event.node?.req as object | undefined;
    if (env && request) {
      Object.defineProperty(request, EDITORIAL_ENV_KEY, {
        value: env,
        enumerable: false,
        configurable: true
      });
    }
  });
}
