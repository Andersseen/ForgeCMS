import { mergeApplicationConfig, type ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

/**
 * The server application (spec 078): the browser config plus Angular's server rendering providers.
 * Forge's server transport is added per render in `main.server.ts`, next to that render's `REQUEST`.
 */
export const serverConfig: ApplicationConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering()]
});
