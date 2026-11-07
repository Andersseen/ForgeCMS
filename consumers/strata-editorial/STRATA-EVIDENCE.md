# Evidence for Strata maintainers: ForgeCMS editorial consumer

For citation by a future, separately authorized Strata PR. **This file edits nothing in Strata** and closes no Strata
criterion. Full context: [ADOPTION-REPORT.md](ADOPTION-REPORT.md).

## Identification

- Consumer: `Andersseen/ForgeCMS`, `consumers/strata-editorial`, branch `feat/strata-rc-real-consumer-adoption`
  (base `main` `a57c494`). Cite the merge commit once merged; until then, the PR head.
- Strata tuple **installed**: core 0.2.2 / analog 0.12.1 / server-components 0.17.0 (integrities identical to the
  RC0 frozen candidate `983f7131e39574e0`). **Not `1.0.0-rc.0`** (unpublished on 2026-11-07).
- Framework tuple: Angular 22.2.3 (single copy), Analog 2.7.2, Vite 8.3.0, Nitro 2.13.4, H3 1.15.11, TS 6.0.3,
  Wrangler 4.135.0, Node 22, compatibility date 2026-09-21, no flags.
- Consumer packages: published `@forge-cms/*` 1.0.0 server packages (no Angular dependency).

## Evidence level per RC contract id (rehearsal on the RC0 baseline)

| Id                   | Consumer evidence                                                                                         | Level                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `SC-NODE`            | built `node-server`, durable libSQL, 44 HTTP checks, shutdown, failure/recovery                           | LOCAL PROCESS + HOSTED CI    |
| `SC-PAGES`           | Pages build on local workerd + local D1; 35 HTTP checks; 9 Chromium tests                                 | LOCAL WORKERD (not deployed) |
| `SC-API`             | only public exports used; typechecked on TS 6.0.3                                                         | CONSUMER                     |
| `SC-SSR`             | buffered SSR of a real data-backed Server Component                                                       | LOCAL + HOSTED CI            |
| `SC-SSR-FAILURE`     | both halves registered; DB outage → generic 500 `no-store`                                                | LOCAL + HOSTED CI            |
| `SC-NAVIGATION`      | `StrataDocumentLink`/`Navigator`/guard; Back/Forward/reload; conventional ↔ SC routes                     | CHROMIUM                     |
| `SC-ISLANDS`         | two independent islands; hydration reuses SSR DOM; pre-hydration click replayed once; one POST per action | CHROMIUM (Node + workerd)    |
| `SC-AUTHORIZATION`   | application-owned (ForgeCMS) rules; cross-user, viewer, anonymous, forged identity; 0 crossings / 300 req | LOCAL + HOSTED CI            |
| `SC-CONFIDENTIALITY` | marked modules absent from browser output incl. maps; positive control detected                           | BUILD OUTPUT                 |
| `SC-BUILD-IDENTITY`  | distinct `buildId` per release; `data-strata-build` asserted; no cross-build hydration                    | LOCAL A/B                    |
| `SC-ROLLBACK`        | A → B → retained A on one database; sessions/data/schema preserved                                        | LOCAL A/B (not deployed)     |
| Real application use | —                                                                                                         | **NOT RUN**                  |

## Findings for separate Strata work

- **S-1** `StrataAnalogRequest.url` has a placeholder origin (`http://localhost`) on Node `node-server`; origin
  checks built on it refuse legitimate same-origin mutations. Minimal reproduction (published analog 0.12.1):
  `consumers/strata-editorial/tests/strata-findings.test.ts`. Suggested scope: document the URL's origin semantics,
  or derive it from the request (Host / forwarded proto) consistently with Pages; add a regression test.
- **S-2** `ControllerClass` (`new () => object`) contradicts the README `controllerFactory` example (required
  constructor argument). Suggested scope: widen the type for factory-registered controllers, or fix the example.
- **R-1** (operational, informative): Nitro `node-server` cannot serve a previous release's hashed assets added after
  build. Strata's skew handling stays fail-safe in that case; seamless retention is a host/CDN responsibility.

## Not claimed

No RC qualification, no deployed endpoint, no operational adoption, no human acceptance, no GA criterion.
