# @forge-cms/testing

Shared test helpers and the **adapter contract suites** for ForgeCMS. If you write a database, auth, storage or
analytics adapter, run these against it: an adapter is only supported when it passes them.

**Who needs it:** adapter authors and contributors. **Boundary:** development and test dependency only — never a runtime dependency.

```sh
pnpm add -D @forge-cms/testing vitest
```

```ts
import { runDatabaseAdapterContractTests } from '@forge-cms/testing/contracts';
import { MyDatabaseAdapter } from './my-database-adapter.js';

runDatabaseAdapterContractTests(() => new MyDatabaseAdapter());
```

## Entry points

- `@forge-cms/testing` — `createTestCollection`, `createTestRequest`.
- `@forge-cms/testing/contracts` (an intentional public subpath) — `runDatabaseAdapterContractTests` (plus the query,
  constraint, conditional-write and atomic-write suites), `runAuthAdapterContractTests`, `runStorageAdapterContractTests`,
  `runAnalyticsWriterContractTests`, and the behavioural suites for schema drift, migrations, version history, relation
  lifecycle, locale merge, write access, global lifecycle, first-admin bootstrap, last-admin concurrency and auth-managed delete.

The suites use Vitest's globals. Reference: [docs/REFERENCE.md](../../docs/REFERENCE.md#forge-cmstesting) · adapters guide:
<https://forge-cms.pages.dev/docs/adapters#writing-your-own>
