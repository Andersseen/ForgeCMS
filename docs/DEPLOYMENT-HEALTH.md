# Deployment health — the public Pages apps

Operator runbook for the two Cloudflare Pages projects this repository deploys (spec 075):

| Project          | App                    | URL                              | Health gate                                           |
| ---------------- | ---------------------- | -------------------------------- | ----------------------------------------------------- |
| `forge-cms`      | `apps/www`             | https://forge-cms.pages.dev      | `/api/status`, `/api/v1/collections`                  |
| `forge-cms-demo` | `apps/demo-aesthetics` | https://forge-cms-demo.pages.dev | `/api/status`, `/api/site/home`, `/api/site/settings` |

A deployment is healthy only when its API starts, not when the static files uploaded. After every
deploy, CI runs `node scripts/verify-deployment.mjs www|demo`. It polls each endpoint (12 attempts,
5 s apart, 10 s timeout each), requires HTTP 200 and a non-empty payload, and fails the deploy job
otherwise. **Never weaken this check to turn CI green — fix production.**

Run it yourself at any time (read-only GET requests):

```bash
node scripts/verify-deployment.mjs demo
DEPLOY_HEALTH_ATTEMPTS=1 node scripts/verify-deployment.mjs www
```

## Reading a failure

`/api/status` answers `503` with a safe diagnostic when the runtime cannot start:

```json
{
  "error": {
    "code": "RUNTIME_STARTUP_FAILED",
    "message": "The CMS runtime could not start.",
    "details": { "stage": "database", "reason": "blocking schema drift: …", "runbook": "…" }
  }
}
```

It never contains a secret value, database id, SQL, row data or stack trace. The full error is in the
server log only:

```bash
pnpm exec wrangler pages deployment list --project-name=forge-cms-demo --environment=production
pnpm exec wrangler pages deployment tail <deployment-id> --project-name=forge-cms-demo --format=json
```

(then request `/api/status` in another terminal). A startup failure is not cached: once the cause is
fixed, the next request starts cleanly.

| `stage`         | `reason`                               | Fix                                                              |
| --------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `auth`          | `AUTH_SECRET is not set`               | Set the secret (below), then redeploy                            |
| `auth`          | `AUTH_SECRET is shorter than 32 bytes` | Set a new, longer secret (below), then redeploy                  |
| `database`      | `blocking schema drift: …`             | Reviewed migration (below). Never drop tables or `_forge_schema` |
| `database`      | `the database could not be prepared`   | Check the D1 binding in `wrangler.toml` and the database itself  |
| `configuration` | `the CMS configuration is invalid`     | A code error: read the log line, fix, redeploy                   |
| `seed`          | `the initial content could not …`      | Read the log line; the seed only runs on an empty database       |

A body of `{"statusCode":500,"statusMessage":"Server Error"}` with no `error.code` means the deployed
build predates these diagnostics — use the log.

## Setting `AUTH_SECRET`

Production refuses to sign sessions with Forge's public development secret (spec 069). Generate a
value and pipe it straight into Wrangler, so it never appears on screen, in shell history or in git:

```bash
openssl rand -base64 48 | pnpm exec wrangler pages secret put AUTH_SECRET --project-name=forge-cms-demo
pnpm exec wrangler pages secret list --project-name=forge-cms-demo   # names only
```

Pages applies a secret to **new** deployments: redeploy (re-run the CI deploy job) afterwards.
Rotating it signs every user out. CI's preflight step checks that the name `AUTH_SECRET` exists
(names only); if its token cannot list secrets it warns and leaves the post-deploy check authoritative.

## Blocking schema drift on a deployed D1

Follow [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md#operator-guide) and
[BACKUP-RESTORE.md](BACKUP-RESTORE.md). Never recreate the database, delete `_forge_schema` or reseed
over editor data to get the site back.

Each public app keeps its reviewed migrations in `src/server/api/migrations.ts` (append-only).
`apps/upgrade-rehearsal/ops/remote-migrate.ts` runs the spec 072 runtime workflow against the remote
D1 through Wrangler's remote bindings, with the app's own collections:

```bash
# 1. Backup (read-only). Keep it outside the repository: it holds password hashes.
pnpm exec wrangler d1 export forge-cms-demo --remote --output=/secure/backups/forge-cms-demo.sql
shasum -a 256 /secure/backups/forge-cms-demo.sql

# 2. Plan (read-only apart from creating Forge's own empty migration ledger).
cd apps/upgrade-rehearsal
pnpm exec tsx --tsconfig ops/tsconfig.tsx.json ops/remote-migrate.ts demo

# 3. Rehearse on a local restore of the backup.
pnpm exec wrangler d1 execute forge-cms-demo --local --persist-to /tmp/rehearsal \
  --config <a config naming the same database> --file /secure/backups/forge-cms-demo.sql --yes
FORGE_MIGRATE_LOCAL=/tmp/rehearsal/v3 pnpm exec tsx --tsconfig ops/tsconfig.tsx.json \
  ops/remote-migrate.ts demo --apply          # must end with "Schema plan: no changes."

# 4. Apply to production, then verify.
pnpm exec tsx --tsconfig ops/tsconfig.tsx.json ops/remote-migrate.ts demo --apply
node scripts/verify-deployment.mjs demo
```

Destructive migrations are refused by this tool. The maintenance runtime uses a throwaway signing
secret: it never issues or verifies sessions and never reads the production `AUTH_SECRET`.

## Status log

- **2026-09-30 (spec 075).** Both projects had an `AUTH_SECRET` configured (names checked). Both
  `/api/status` returned 500 because `syncSchema()` refused blocking drift on their pre-M01 D1s:
  - `forge-cms-demo`: `media._storageKey` on 9 seeded static-image rows. Migration
    `20260930_001_media_storage_key`.
  - `forge-cms`: `posts._status` on 1 row. Migration `20260930_001_posts_status`.

  Both were backed up (`wrangler d1 export --remote`, SHA-256 recorded outside git), planned remotely
  and rehearsed on local restores (post-flight plan: no changes). Production was migrated on
  2026-10-04 (next entry).

- **2026-10-04 — recovered.** Remote read-only plans still showed exactly the one blocking change per
  app (above), its reviewed migration `pending`, and nothing destructive. Both apps had been failing
  startup since, so writes were already quiesced. For each app separately:
  1. Fresh `wrangler d1 export --remote` outside the repository (`forge-cms` SHA-256 `52a239b2…3158d`,
     `forge-cms-demo` `f279cf58…8277b`). Neither DB references an R2 object (`www` media empty; the demo's
     9 media rows are static images with no stored key), so no object copy was needed.
  2. Restored locally and rehearsed `--apply`: post-flight `Schema plan: no changes.`, rerun
     `already-applied`, every pre-existing table's row count and content digest unchanged.
  3. `remote-migrate.ts <www|demo> --apply` on production: `20260930_001_posts_status` (`forge-cms`) and
     `20260930_001_media_storage_key` (`forge-cms-demo`) → `applied`, post-flight `no changes`.
     (Wrangler's remote proxy printed transient `Network connection lost` lines, also on read-only runs;
     the ledger and a fresh plan were checked directly afterwards.)
  4. Verified: `_forge_migrations` holds exactly one row per DB (`applied`); a fresh plan reports
     `no changes`; a second `--apply` returns `already-applied`; the www post reads as `published`, the
     demo's 9 media rows keep `_storageKey` NULL.
  5. Health: `/api/status` and `/api/v1/collections` (www), `/api/status`, `/api/site/home` and
     `/api/site/settings` (demo) all 200; `node scripts/verify-deployment.mjs www` and `… demo` healthy
     on attempt 1 without redeploying (startup failures are not cached).
  6. A post-migration export, taken after both apps had started, matches the pre-migration backup
     table-for-table (row counts and content digests, ignoring only the migrated column): no reseed, no
     data change. Only Forge's internal tables (`_forge_schema`, `_forge_migrations`,
     `_forge_storage_intents`) and www's empty `tags` table were added by the post-flight sync.
