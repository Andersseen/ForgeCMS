import { InjectionToken } from '@angular/core';
import type { ForgeCmsConfig, ForgeTransport, ForgeTransportRequest } from './types.js';

/** One request as `ForgeRequester` hands it to the server policy (spec 078). */
export interface ServerRequestInput {
  url: string;
  method: ForgeTransportRequest['method'];
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal | undefined;
  /** Login/signup/logout: never carries an `Authorization` header. */
  authAction: boolean;
  /** The configured `authToken`, read only when a header may carry it. */
  token: () => string | null;
}

/**
 * One render's server policy, resolved from that render's own `REQUEST` by `provideForgeCmsServer`
 * (`server-context.ts`). Internal. Only this interface and the token are imported by `CmsApiService`, so
 * the implementation stays out of browser bundles that never import `@forge-cms/angular/server`.
 */
export interface ForgeServerContext {
  readonly origin: string;
  /** Throws a `TypeError` when the app's `ForgeCmsConfig` contradicts the forwarding policy. */
  assertCompatible(config: ForgeCmsConfig | null): void;
  request(input: ServerRequestInput, config: ForgeCmsConfig | null): ForgeTransportRequest;
  /** The default server transport (used unless `ForgeCmsConfig.transport` replaces it). */
  readonly transport: ForgeTransport;
}

export const FORGE_SERVER_CONTEXT = new InjectionToken<ForgeServerContext | null>(
  'FORGE_SERVER_CONTEXT'
);
