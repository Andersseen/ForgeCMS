# Staging deployment and recovery rehearsal (roadmap 0.12 / R03)

The operator procedure behind [spec 090](specs/090-staging-deployment-and-recovery-rehearsal.md): deploy one exact candidate of
`apps/tiny-project` to an **isolated** Cloudflare staging environment, exercise it over its real HTTPS origin, then back it up and
restore it into **separate, empty** D1 + R2 targets. It does not replace the canonical guides — see
[DEPLOYMENT-HEALTH.md](DEPLOYMENT-HEALTH.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md) and [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md) for detail.

> Remote steps create billable Cloudflare resources and need explicit authorization. Nothing here touches `forge-cms`,
> `forge-cms-demo` or their databases/buckets, and the tooling refuses those names.

## Profiles

| Profile        | Database                           | Objects                      | Auth                         | Origin served by            |
| -------------- | ---------------------------------- | ---------------------------- | ---------------------------- | --------------------------- |
| **Cloudflare** | D1 (binding `DB`)                  | R2 (`BUCKET`)                | `UsersCollectionAuthAdapter` | Pages (this rehearsal)      |
| **Portable**   | on-disk libSQL (persistent volume) | S3 (Garage v2.4.1 certified) | same                         | Node/Nitro — `pnpm test:s3` |

A production build with only one binding, or neither, refuses to start (`apps/tiny-project/src/server/api/profile.ts`); it never falls
back to in-memory. Remote staging proves the bindings are _really_ present, not that the refusal works (that is local evidence).

## Names (all start with `forge-cms-r03-`)

`pnpm staging manifest [--suffix s]` prints the exact set. Default (no suffix): Pages `forge-cms-r03-staging`, D1
`forge-cms-r03-staging-db`, R2 `forge-cms-r03-staging-media`; restore target Pages `forge-cms-r03-restore`, D1
`forge-cms-r03-restore-db`, R2 `forge-cms-r03-restore-media`; disposable copy Worker `forge-cms-r03-r2-copy`. The scripts refuse any name
that is a known production identifier, does not carry the prefix, is empty, or makes source equal target.

## Prerequisites

- A candidate commit with a clean tree and green local gates: `pnpm release:certify`, `pnpm test:coverage`, `pnpm test:performance`,
  `pnpm test:stability`.
- `pnpm exec wrangler whoami` succeeds (Wrangler is pinned at 4.91.0; this runbook uses only syntax that version supports).
- Written authorization for exactly the resources in the manifest.

## Steps

All mutating steps are dry runs unless `--apply` is given. Generated evidence lives in the gitignored `.staging/`.

1. **Plan** — `pnpm staging plan provision`, `plan secrets`, `plan deploy --commit $(git rev-parse HEAD)`.
2. **Provision** — `pnpm staging run provision --apply` (D1, R2, Pages project). Note the D1 id, then bind `DB`/`BUCKET` to the Pages project
   in the dashboard or a staging-only wrangler config (never edit `apps/tiny-project/wrangler.toml`, which is the local fixture).
3. **Secrets** — `pnpm staging run secrets --apply` generates a fresh `AUTH_SECRET`, pipes it to `wrangler pages secret put`, and prints nothing.
   Set `FORGE_SSR_ORIGIN` to the project's real `https://<project>.pages.dev` origin (a variable, not a secret), then redeploy.
4. **Build and deploy** — `pnpm --filter @forge-cms/tiny-project build`, then `pnpm staging run deploy --apply --commit <sha>`.
5. **Health (read-only, rerunnable)** — `pnpm staging verify --origin https://<project>.pages.dev`. Checks collection metadata, the public
   post list, anonymous `401`/`404` bodies, `/studio/login` and `/`, and fails on any status mismatch or on `passwordHash`,
   `_sessionVersion`, `D1_ERROR`, `too many SQL variables` or a supplied `--secret` marker in a body.
6. **Journey** — bootstrap the first admin (`POST /api/bootstrap-admin`), sign in at `/studio/login`, create a draft with a relation,
   confirm it is invisible anonymously, publish, edit, upload a file, fetch it via `/api/media/…`, delete it; check the CSRF denial of a
   cookie-authenticated cross-origin write. Then **redeploy the same commit** and repeat the reads (D1 and R2 state must survive).
7. **K3** — against the staging D1, run `GET /api/content/posts?title[in]=…` with 80, 99, 100, 120 and 400 values; expect `200` for all.
8. **Quiesce, then back up** — stop every writer (browser sessions, scripts). `pnpm staging run export --apply --out .staging/database.sql`,
   record its SHA-256, then `pnpm staging keys --snapshot .staging/database.sql` for the required R2 keys. Never derive keys by listing the bucket.
9. **Copy objects with metadata** — Wrangler 4.91's `r2 object put` has no custom-metadata option, so deploy
   `scripts/staging/r2-copy-worker.mjs` as the disposable Worker `forge-cms-r03-r2-copy` (bindings `SOURCE`, `TARGET`, secret `COPY_TOKEN`),
   `POST /copy` the key list, `POST /inspect` it against the target, `pnpm staging compare` the two records, then delete the Worker.
10. **Restore** — into the new restore D1 and R2 only (`wrangler d1 execute <restore-db> --remote --file .staging/database.sql`), deploy the
    restore Pages project bound to the restore resources, and verify: clean schema plan, migration ledger intact, same admin and login,
    same content ids and relations, same `_storageKey`s and bytes, a post-restore write works. The restored app must never be bound to a
    source resource.
11. **Cleanup** — staging is retained only if the maintainer says so; otherwise delete the Pages projects, D1 databases and R2 buckets named
    in the manifest (and nothing else).

## Practical notes (from the 2026-10-12 run)

- **Never run Wrangler for Pages through `pnpm --dir …` or from the repository root.** The root `wrangler.toml` is the production website's
  config; Pages reads the config of the current directory. Generate a directory with a `wrangler.toml` (`pages_build_output_dir = "public"`, `DB`,
  `BUCKET`, `FORGE_SSR_ORIGIN`) plus a copy of `apps/tiny-project/dist/analog/public`, `cd` into it and call the absolute `node_modules/.bin/wrangler`.
  Pages has no `--config` flag. `pnpm staging run deploy` plans the generic command only; it does not do this.
- The Worker for the R2 copy and `wrangler delete` need the same care (run from the Worker's own directory with `--name`).
- Install `COPY_TOKEN` immediately after `wrangler deploy`; the Worker refuses every request until it exists.
- `d1 export` prints a one-hour pre-signed download URL; treat the terminal output as sensitive.
- Empty a restore R2 bucket (delete the known keys) before `r2 bucket delete`.
- `wrangler pages deployment tail <deployment-id> --format json` needs the full deployment id; it echoes request headers (cookies included).
- Journey and restore checks: `node scripts/staging/journey.mjs write|read|post-write --origin https://…` (state in the gitignored `.staging/`).
- The schema plan, migration history and `reconcileStorage()` of a restored database have no HTTP route; run the runtime against the restore bindings with
  `wrangler dev --remote` from an ephemeral directory.

## Portable profile

Node/Nitro with a durable on-disk libSQL file **on a persistent volume** (a container's ephemeral filesystem is not durable) and
S3-compatible storage with separate state. Back up quiesced; derive required objects from the database snapshot; restore to a **new**
database path and an **empty** bucket. There is no atomic DB + S3 snapshot. Evidence: `pnpm test:s3`, `pnpm test:upgrade`, `pnpm release:certify`
against Garage v2.4.1 — AWS S3, Backblaze B2 and Wasabi are not certified.

## Limits

Staging is not production traffic. There is no cross-resource atomic snapshot and no maintenance mode; quiescence is an operator action.
Local workerd evidence is recorded separately from remote evidence and never substitutes for it.
