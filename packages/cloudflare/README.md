# @forge-cms/cloudflare

Cloudflare-native adapters and types for ForgeCMS.

## Target services

| Service | Binding type | Adapter             | Status                                  |
| ------- | ------------ | ------------------- | --------------------------------------- |
| **D1**  | `D1Database` | `D1DatabaseAdapter` | Implemented (SQL native, Drizzle-ready) |
| **R2**  | `R2Bucket`   | `R2StorageAdapter`  | Implemented                             |

No KV adapter — nothing in the runtime today needs a key-value store (no caching/settings layer).

**Analytics Engine** (`AnalyticsEngineWriter` + `AnalyticsEngineQueryClient`) is implemented and
experimental — see [Forge Analytics](#forge-analytics-experimental) below.

## Preparing for Cloudflare (no real account required yet)

### 1. D1 Database

The `D1DatabaseAdapter` is ready to use. It currently runs native D1 SQL via the `DatabaseAdapter` contract. The adapter is **Drizzle-ready**: the schema generator and value mapping are shared with `@forge-cms/db`, so switching to Drizzle's D1 driver is a one-line change when you are ready.

```ts
import { D1DatabaseAdapter } from '@forge-cms/cloudflare';

const runtime = new ForgeCmsRuntime({
  collections: [...],
  adapters: {
    database: new D1DatabaseAdapter(),
    // auth, storage...
  }
});

runtime.init({ DB: env.DB }); // Cloudflare binding
await runtime.syncSchema();
```

To activate D1 later:

1. Create a D1 database in the Cloudflare dashboard.
2. Add the binding to `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "forge-cms"
   database_id = "your-database-id"
   ```
3. Run migrations: `pnpm --filter @forge-cms/db db:push`

### 2. R2 Storage

```ts
import { R2StorageAdapter } from '@forge-cms/cloudflare';

const storage = new R2StorageAdapter();
storage.init({ BUCKET: env.BUCKET });
storage.setPublicUrlBase('https://pub-your-id.r2.dev');
```

### 3. Wrangler config

The root `wrangler.toml` is already configured for Cloudflare Pages. Update it with your bindings when ready:

```toml
name = "forge-cms"
compatibility_date = "2026-05-15"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "apps/www/dist/analog/public"

[[d1_databases]]
binding = "DB"
database_name = "forge-cms"
database_id = "<your-id>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "forge-cms-media"
```

## Local development

For local development use `LibSqlDatabaseAdapter` from `@forge-cms/db` with a SQLite file. It shares the same schema generator, so migration to D1 is seamless.

## Forge Analytics (experimental)

Privacy-minimizing pageview analytics on top of Cloudflare Workers Analytics Engine — see
[spec 057](../../docs/specs/057-cloudflare-analytics-foundation.md) for the full design, collected
fields, and what is deliberately not collected. This is an **opt-in, experimental ForgeCMS
capability**, not a general analytics platform: it never runs unless an app wires it up, and it never
touches `ForgeCmsRuntime`, `core`, or the API envelope.

### 1. Write side — `wrangler.toml`

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "your_dataset_name"
```

The dataset is created automatically on first write — no manual provisioning step.

```ts
import { AnalyticsEngineWriter, NoopAnalyticsWriter } from '@forge-cms/cloudflare';

// Pick a writer based on whether the binding exists, so a misconfigured/local environment degrades
// to a silent no-op instead of crashing the request.
const writer = env.ANALYTICS ? new AnalyticsEngineWriter().init(env) : new NoopAnalyticsWriter();

writer.recordPageview({
  siteId: 'my-site', // one stable identifier per deployment — the dataset's index1
  pathname: sanitizedPath, // never a raw request path — strip query/hash first
  referrerHost: sanitizedReferrerHost, // hostname only, '' if none
  country: sanitizedCountry // 2-letter ISO code from the CF-IPCountry header, '' if unknown
});
```

Use `sanitizePathname`/`sanitizeReferrerHost`/`sanitizeCountry`/`sanitizeSiteId` (also exported) to
build those fields — they are the only place query-string stripping and referrer-to-hostname
reduction happen, so nothing scatters that logic across routes.

### 2. Read side — server-only secrets

Querying is Cloudflare's Analytics Engine **SQL API** (an external HTTPS call, not a binding), so it
needs two secrets that must never reach the browser:

```bash
# Set via `wrangler pages secret put` / your platform's secret store — never commit real values.
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ANALYTICS_TOKEN=...   # API token scoped to Account > Account Analytics > Read
```

```ts
import { AnalyticsEngineQueryClient } from '@forge-cms/cloudflare';

const client = new AnalyticsEngineQueryClient({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  apiToken: env.CLOUDFLARE_ANALYTICS_TOKEN,
  dataset: 'your_dataset_name'
});

const summary = await client.getSummary('my-site', '7d'); // '24h' | '7d' | '30d' | '90d'
```

Gate this behind your own admin-only auth check — the SQL API must never be reachable by an
unauthenticated caller. Retention is Analytics Engine's own 90 days; there is no historical range
beyond that.

### 3. Browser + admin UI

The tracker (`provideForgeAnalytics` from `@forge-cms/angular`) and the reusable admin dashboard
(`forgeAdminAnalyticsRoutes`/`ForgeAnalyticsDashboardComponent` from `@forge-cms/admin`) are
documented in [spec 057](../../docs/specs/057-cloudflare-analytics-foundation.md)'s Design section and
each package's own exported doc comments. See `apps/demo-aesthetics` for a complete, working wiring of
all three layers.
