# @forge-cms/cloudflare

Cloudflare-native adapters and types for ForgeCMS.

## Target services

| Service | Binding type | Adapter | Status |
|---------|-------------|---------|--------|
| **D1** | `D1Database` | `D1DatabaseAdapter` | Implemented (SQL native, Drizzle-ready) |
| **R2** | `R2Bucket` | `R2StorageAdapter` | Implemented |
| **KV** | `KVNamespace` | — | Types only |

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
pages_build_output_dir = "apps/www/dist"

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
