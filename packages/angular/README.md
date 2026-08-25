# @forge-cms/angular

Angular client SDK for ForgeCMS.

```sh
pnpm add @forge-cms/angular
```

```ts
import { provideForgeCms } from '@forge-cms/angular';

export const appConfig = {
  providers: [provideForgeCms({ baseUrl: '/api' })]
};
```

Exports include `CmsApiService`, `provideForgeCms`, query helpers, typed response shapes, auth role
helpers, and signal-based read resources.

This package is compiled as an Angular partial-Ivy library. Consumers must install a compatible
Angular version and let their Angular build/linker process dependencies as usual.
