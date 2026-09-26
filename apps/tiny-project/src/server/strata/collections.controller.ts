import { Controller, Get } from '@strata-sc/core';
import type { StrataAnalogRequest } from '@strata-sc/analog';
import type { ApiContext } from '@forge-cms/api';
import { handleList } from '@forge-cms/runtime';
import type { ServerEnv } from '../api/runtime';
import { getServerRuntime } from '../api/runtime';
import { readCloudflareEnv, toForgeRequest } from './forge-request';

/**
 * Transport only: adapts a Strata request to Forge's `ApiContext` and delegates to the same
 * `handleList` the H3 routes use. Access, filters, pagination and the response envelope all stay
 * in `@forge-cms/runtime`; the returned `Response` goes back to Nitro untouched.
 */
@Controller('/api/v1')
export class CollectionsController {
  @Get('/:collection')
  async list(request: StrataAnalogRequest): Promise<Response> {
    const env = readCloudflareEnv(request.context);
    const runtime = await getServerRuntime(env);
    const context: ApiContext<ServerEnv | undefined> = {
      request: toForgeRequest(request),
      params: { collection: request.params['collection'] ?? '' },
      env
    };
    return handleList(context, { runtime });
  }
}
