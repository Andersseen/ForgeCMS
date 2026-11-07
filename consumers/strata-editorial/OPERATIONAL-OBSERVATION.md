# Operational observation record: status NOT RUN

Real operational adoption **has not started**. No deployment exists, no real user has used the application, and no
observation time has elapsed. Nothing below may be read as evidence until it is filled in from a real run.

## Preconditions (all open)

1. `1.0.0-rc.N` published; the three Strata pins switched; every suite green locally and in hosted CI on that tuple.
2. A maintainer authorizes **one** host: a new, isolated Cloudflare Pages project with a dedicated D1 database, or
   a Node host with a durable libSQL volume. Never an existing production project.
3. `AUTH_SECRET` (≥ 32 bytes) and `EDITORIAL_BUILD_ID` per release set by the deploy pipeline; the database seeded
   with **real** editor accounts (not the synthetic fixture), first account = admin.
4. The previous release artifact retained for rollback; the static layer keeps the previous release's hashed assets
   (finding R-1), or the fail-safe stale-document behaviour is accepted explicitly.

## Proposed observation period

**7 consecutive days** of real editorial use as a starting point, extended until the minimum volume is reached:
at least 2 editors, 20 publish/unpublish actions, 500 document views. One editorial team is the realistic scale
for this application; a synthetic load test does not substitute for any of it.

## Objectives during the period

| Signal                         | Objective                                                       | Source                                        |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| Unexpected 5xx (documents/API) | < 0.5 % of requests; 0 sustained for > 5 min                    | host logs (error class names only)            |
| Authorization incidents        | 0 cross-user reads/writes, 0 private document served publicly   | access logs + the HTTP matrix re-run daily    |
| Latency (documents)            | p95 < 500 ms at the edge / host                                 | host analytics                                |
| Hydration                      | ≥ 99 % `committed` observations; 0 unexplained `build-mismatch` | `provideStrataHydrationObserver` (opt-in RUM) |
| Memory (Node)                  | no monotonic RSS growth across days                             | host metrics                                  |

## Abort criteria (roll back to the retained artifact immediately)

Any confirmed cross-user read or write; any private draft served under a public cache key; a secret or stack trace
in a response; unexpected 5xx above 2 % for 15 minutes; data loss or a schema change not in a reviewed migration.

## Rollback procedure

Redeploy the retained previous artifact with the same `DATABASE_URL`/D1 binding and `AUTH_SECRET` (sessions survive;
rehearsed in `qualification/upgrade-rollback.ts`). No schema migration exists, so the database needs no rollback.

## Record (to be filled from the real run)

| Field                               | Value   |
| ----------------------------------- | ------- |
| Strata tuple and integrities        | NOT RUN |
| Consumer commit / deployed revision | NOT RUN |
| Environment and host                | NOT RUN |
| Start / end (UTC), duration         | NOT RUN |
| Real users, actions, views          | NOT RUN |
| 5xx rate, p95 latency, memory trend | NOT RUN |
| Incidents, rollbacks performed      | NOT RUN |
| Human acceptance (name, date)       | NOT RUN |
