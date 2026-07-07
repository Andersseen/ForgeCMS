# CONTEXT — What ForgeCMS is and why it exists

> Audience: humans and AI agents starting work on this repo. This file explains intent. For what is
> actually built today, read [STATE.md](STATE.md).

## The problem

Code-first headless CMSs (Payload, KeystoneJS, Strapi-with-code) are React/Node-centric. The Angular
ecosystem has no equivalent: an Angular or Analog.js developer who wants a CMS must either adopt a
React admin panel, a SaaS CMS, or build CRUD plumbing by hand.

## The vision

ForgeCMS wants to be for Angular/Analog.js what Payload is for React/Next.js:

- **Code-first schema.** Collections are defined in TypeScript with `defineCollection` /
  `defineField` and give full type inference (`CollectionData<typeof posts>`). No GUI schema builder,
  no YAML.
- **Mountable API.** A runtime (`ForgeCmsRuntime`) binds collections + adapters and exposes
  framework-agnostic CRUD handlers that return standard `Response` objects, so they mount into any
  h3/Nitro (Analog.js) server — and potentially other runtimes later.
- **Adapter architecture.** Database, auth, and storage are swappable contracts. Reference
  implementations: in-memory (dev/tests), LibSQL/drizzle, Cloudflare D1 (db); token-based (auth);
  in-memory, Cloudflare R2 (storage).
- **Edge-first.** First-class target is Cloudflare Pages/Workers with D1 + R2 (+ KV planned). No
  assumption of a long-lived Node server.
- **Angular-native admin.** An admin UI shipped as Angular components (`@forge-cms/admin`) plus a
  typed client SDK (`@forge-cms/angular`).

## End-state developer experience (north star)

```ts
// The experience we are building toward, in an Analog.js app:
const posts = defineCollection({ slug: 'posts', fields: { title: defineField.text({ required: true }) } });
const runtime = new ForgeCmsRuntime({
  collections: [posts],
  adapters: { database: new D1DatabaseAdapter(), auth: ..., storage: new R2StorageAdapter() }
});
// → REST API at /api/v1/posts, typed Angular SDK, admin UI at /admin
```

## Product pillars (use these to judge design decisions)

1. TypeScript type-safety end to end — schema types flow to API payloads and the Angular SDK.
2. Zero lock-in — every infrastructure concern behind an adapter contract with contract tests.
3. Edge-compatible — no Node-only APIs in `packages/*` runtime code paths.
4. Angular-idiomatic — signals, standalone components, `inject()`, provide-functions.
5. Small, publishable packages — each `@forge-cms/*` package is independently useful.

## Non-goals (for now)

- Visual page builder / drag-and-drop schema editing.
- GraphQL API (REST only).
- Multi-tenancy, i18n of content, versioning/drafts workflows.
- Supporting React/Vue admin UIs.
- Backwards compatibility guarantees — everything is 0.0.0 and unpublished; breaking changes are fine
  while experimental.

## Ecosystem context

- **Monorepo**: this repo (`forge-cms/forge-cms` on GitHub) holds all packages and two apps.
- **apps/www** is both the public landing page (deployed to Cloudflare Pages) and the living demo of
  the CMS (its `/admin` section and `/api/v1/*` API run on the real runtime with in-memory adapters).
- **apps/playground** is a scratch app for trying future CMS APIs.
- **@voltui/components** (Volt UI) is the author's own Angular UI library, developed in the sibling
  repo `../volt-ui` and consumed from npm by `apps/www`. Prefer it for admin/landing UI work.
- Versioning/publishing via **Changesets** under the `@forge-cms` npm scope (nothing published yet).

## Inspiration

Payload CMS (config-as-code, collections, admin), Drizzle (typed SQL), Analog.js (Angular meta-framework
with Nitro server routes).
