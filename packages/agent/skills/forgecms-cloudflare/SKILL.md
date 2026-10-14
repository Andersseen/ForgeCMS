---
name: forgecms-cloudflare
description: Deploy ForgeCMS on Cloudflare (D1 + R2) safely - bindings, AUTH_SECRET, FORGE_SSR_ORIGIN, durable profile, schema plan and what is certified versus what the operator must verify.
---

# ForgeCMS on Cloudflare

## Bindings (`wrangler.toml`)

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-app"
database_id = "<your-id>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "my-app-media"
```

`binding` is the name your code reads. The profile factory requires **both** `env.DB` and `env.BUCKET`. Keep the names, or pass `new D1DatabaseAdapter({ binding: 'X' })` / `new R2StorageAdapter({ binding: 'Y' })`.

Pages needs `name`, `pages_build_output_dir` and an explicit `compatibility_date` that is not newer than the pinned wrangler supports; `nodejs_compat` is required.

## Secrets and variables

- `AUTH_SECRET`: a secret (`wrangler pages secret put AUTH_SECRET`). Never in `[vars]`, never committed.
- `FORGE_SSR_ORIGIN`: a non-secret `[vars]` entry for server-rendered production (the explicit origin the server calls).
- Analytics read credentials are secrets too (see `forgecms-analytics`).

## Durable profile

Production must **refuse to start** when `DB` or `BUCKET` is missing. Do not write `env.DB ? D1 : InMemory`: it deploys something that looks healthy and forgets everything. Reference: the profile factory in the deployment guide.

## Schema and migrations

Run `planSchema()` before deploying. Safe changes sync; risky changes need a reviewed migration run from a deploy script, never at app startup (see `forgecms-migrations-recovery`).

## Certified versus yours

The Cloudflare profile is **certified** by named gates: adapter contracts, local workerd D1/R2, a packed production consumer and an isolated remote staging rehearsal. That is evidence for the framework and the profile. It is **not** a guarantee for your production deployment, traffic level or account configuration - verify your own deploy (health checks, backup and restore rehearsal). Never run unreviewed changes against a production D1/R2.

## Do not

- Do not point a rehearsal or test at production resources.
- Do not rely on an InMemory fallback, or on Turso/serverless filesystems for libSQL (not covered).
