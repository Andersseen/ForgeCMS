import { Controller, Get } from '@strata-sc/core';
import type { StrataAnalogRequest } from '@strata-sc/analog';
import { handleList, handleRead } from '@forge-cms/runtime';
import { getServerRuntime } from '../api/runtime';
import { createForgeReadContext } from './forge-read-context';

/**
 * Transport only: adapts a Strata request to Forge's `ApiContext` and delegates to the same
 * `handleList`/`handleRead` the H3 routes used. Access, drafts, field projection, filters,
 * pagination and the response envelope all stay in `@forge-cms/runtime`; the returned `Response`
 * goes back to Nitro untouched.
 *
 * Reads only. `POST /api/content/:collection` and `PUT`/`DELETE /api/content/:collection/:id` stay H3 file
 * routes: they need the request body and a real origin for CSRF, which Strata 0.1.0 cannot provide
 * (see `createForgeReadContext`).
 */
@Controller('/api/content')
export class CollectionsController {
  @Get('/:collection')
  async list(request: StrataAnalogRequest): Promise<Response> {
    const context = createForgeReadContext(request, {
      collection: request.params['collection'] ?? ''
    });
    return handleList(context, { runtime: await getServerRuntime(context.env) });
  }

  @Get('/:collection/:id')
  async read(request: StrataAnalogRequest): Promise<Response> {
    const context = createForgeReadContext(request, {
      collection: request.params['collection'] ?? '',
      id: request.params['id'] ?? ''
    });
    return handleRead(context, { runtime: await getServerRuntime(context.env) });
  }
}
