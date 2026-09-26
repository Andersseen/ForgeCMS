import type { NitroRouter } from '@strata-sc/analog';
import { registerControllers } from '@strata-sc/analog';
import { CollectionsController } from '../strata/collections.controller';

/**
 * Nitro server plugin (auto-loaded from `src/server/plugins/`) that registers the Strata
 * controllers on Nitro's own router, next to the file-system routes. A plain function rather than
 * `defineNitroPlugin(...)` — that helper is an identity function, and importing it would mean a
 * direct `nitropack` dependency just for its types; Strata's structural `NitroRouter` is all this
 * needs from the Nitro app.
 */
export default function strataPlugin(nitroApp: { readonly router: NitroRouter }): void {
  registerControllers(nitroApp.router, [CollectionsController]);
}
