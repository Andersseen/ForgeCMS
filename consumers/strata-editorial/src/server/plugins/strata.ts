import { registerControllers } from '@strata-sc/analog';
import type { NitroRouter } from '@strata-sc/analog';

import { EditorialService } from '../../app/cms/editorial.service';
import { getEditorialRuntime } from '../../app/cms/runtime';
import { csrfGuard, EditorialController, safeErrors } from '../strata/editorial.controller';
import { editorialEnvFor } from '../strata/request-env';

/**
 * Strata only ADDS routes to the router Nitro already owns. Native H3 routes (`/api/account/*`,
 * `/api/health`) keep working beside them and are declared to the `/api/editorial` boundary so unknown
 * paths there answer a JSON 404 instead of the Angular HTML shell.
 *
 * No Angular injector exists here and none is shared with SSR: the factory builds the controller and its
 * service with plain constructors, which is what runs on workerd (NO-JIT-WORKERD).
 */
export default function strataPlugin(nitroApp: { readonly router: NitroRouter }): void {
  registerControllers(nitroApp.router, [EditorialController], {
    apiBoundary: { prefixes: ['/api/editorial'], options: 'allow' },
    guards: [csrfGuard],
    interceptors: [safeErrors],
    controllerFactory: async (Controller, { request }) => {
      if (Controller !== EditorialController) return new Controller();
      const runtime = await getEditorialRuntime(editorialEnvFor(request));
      return new EditorialController(new EditorialService(runtime));
    }
  });
}
