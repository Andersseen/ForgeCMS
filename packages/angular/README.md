# @forge-cms/angular

Angular client SDK for ForgeCMS.

```sh
pnpm add @forge-cms/angular
```

```ts
import { provideForgeCms } from '@forge-cms/angular';

export const appConfig = {
  // Defaults: same-origin '/api/v1' content, '/api/auth' auth, cookie credentials.
  providers: [provideForgeCms()]
};
```

Options: `baseUrl`, `authBaseUrl`, `credentials` (`'include'` | `'omit'`), `authToken`,
`trustedOrigins` (other origins allowed to receive cookies/Bearer — none by default) and `transport`
(inject a fetch-like function). Identifiers are encoded per path segment, writes are never retried,
and every failure is a `ForgeApiError` with `kind`, `status`, `code` and `details`. A `/me` outage
puts `ForgeAuthSession` in `'error'`, not `'anonymous'`. Full guide:
https://forge-cms.pages.dev/docs/angular-client

Typed client without codegen (spec 076): share the content model's type and call
`injectForgeClient<SiteSchema>()` — slugs, query fields, create/update payloads and read results are
checked against the JSON the server sends (ISO date strings, `depth: 1` targets or `null`,
access-controlled fields optional, localized maps vs strings). `inject(CmsApiService)` stays the
untyped client for dynamic code.

```ts
import type { ForgeSchema } from '@forge-cms/angular';
import type { collections } from '../server/content'; // erased: no server code is bundled
export type SiteSchema = ForgeSchema<typeof collections>;
```

Exports include `CmsApiService`, `injectForgeClient`, `ForgeSchema` and the projection types, `ForgeAuthSession`, `forgeAuthGuard`, `provideForgeCms`,
`ForgeApiError`, query helpers, typed response shapes, auth role helpers, and signal-based read
resources.

This package is compiled as an Angular partial-Ivy library. Consumers must install a compatible
Angular version and let their Angular build/linker process dependencies as usual.
