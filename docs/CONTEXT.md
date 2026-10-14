# CONTEXT — What ForgeCMS is and why it exists

> Audience: humans and AI agents starting work on this repo. This file explains **intent**, not status. What is actually built today is
> [STATE.md](STATE.md); what the 1.0 release stands on is [1.0-RELEASE-DOSSIER.md](1.0-RELEASE-DOSSIER.md); what is deliberately out of scope is
> [LIMITATIONS.md](LIMITATIONS.md).

## The problem

Code-first headless CMSs (Payload, KeystoneJS, Strapi-with-code) are React/Node-centric. The Angular ecosystem has no equivalent: an Angular or
Analog.js developer who wants a CMS must adopt a React admin panel, a SaaS CMS, or build CRUD plumbing by hand.

## The product

ForgeCMS is a **code-first, TypeScript-native headless CMS for Angular and Analog.js**. Payload is product inspiration, not a parity target.

- **Code-first schema.** Collections and globals are TypeScript (`defineCollection`, `defineField`, `defineGlobal`) with full type inference. No GUI schema builder,
  no YAML, no code generation.
- **Local API first.** `ForgeCmsRuntime` runs access control, hooks, drafts, relations and validation as ordinary function calls from server code. The
  framework-agnostic HTTP handlers are a thin transport over the same operations.
- **Adapter architecture.** Database, auth and storage are contracts held to shared contract tests; reference implementations ship for in-memory (dev/test), libSQL,
  Cloudflare D1 / R2 and an S3-compatible service. A new adapter is supported when it passes the contract suites.
- **Cloudflare-first, portable by design.** The first-class profile is Cloudflare Pages/Workers with D1 + R2; the equally supported portable profile is Node with
  on-disk libSQL and S3-compatible storage. Neither silently falls back to in-memory storage in production.
- **Typed client.** `@forge-cms/angular` derives request and response types from the same content model (`ForgeSchema`), with signal resources, a session service
  and SSR support.
- **Reusable Angular admin.** `@forge-cms/admin` is a set of routes and components a host app mounts under its own router; it owns no API URL and no server code.
- **Upgrade and recovery story.** Schema drift is detected before it can damage data, risky changes are applied by reviewed, append-only migrations, and the
  backup/restore procedure is rehearsed on both profiles.

## Product pillars (use these to judge design decisions)

1. TypeScript type-safety end to end — schema types flow to API payloads and the Angular client.
2. Adapter-bounded infrastructure — every infrastructure concern sits behind a contract with contract tests, and "supported" means a named gate ran.
3. Edge-compatible — no Node-only APIs in the `packages/*` code paths the Cloudflare profile uses.
4. Angular-idiomatic — signals, standalone components, `inject()`, `provide…` functions.
5. Small, publishable packages — each `@forge-cms/*` package has a stated responsibility and an explicit server/browser boundary.
6. Honest claims — a capability is stable only with evidence; experimental and intentionally limited things are labelled as such.

## Non-goals for 1.0

REST only (no GraphQL); no visual page builder; no plugin system or marketplace; no required CLI; no email adapter; no image processing or presigned uploads; relation
population depth 1; no atomic database+object-store snapshot, no point-in-time recovery, no down migrations; no React/Vue admin. The maintained list is
[LIMITATIONS.md](LIMITATIONS.md). A visual builder / "ForgeCMS 2.0" direction is only a possible future; it is not a 1.0 promise and nothing in 1.0 depends on it.

## Ecosystem context

- **Monorepo** (`Andersseen/ForgeCMS`): twelve public packages and the apps listed in [CLAUDE.md](../CLAUDE.md). `apps/www` is the official site, docs and the live `/admin`
  demo on the real runtime; `apps/tiny-project` is the external-style consumer used for certification; `apps/demo-aesthetics` is the real-world demo whose purpose is
  [DEMO-FINDINGS.md](DEMO-FINDINGS.md).
- **`@voltui/components`** (Volt UI) is the author's Angular UI library and a peer of `@forge-cms/admin`.
- **Strata** is a separate project. Forge has no dependency on it; `apps/tiny-project` dogfoods it as a consumer. It is not part of the ForgeCMS 1.0 API.
- Versioning and publishing use **Changesets** under the `@forge-cms` npm scope; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Inspiration

Payload CMS (config-as-code, collections, Local API, access functions), Drizzle (typed SQL), Analog.js (Angular meta-framework with Nitro server routes).
