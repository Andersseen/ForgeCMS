# QUICKSTART — try ForgeCMS in 10 minutes

> **Reality check first:** no `@forge-cms/*` package is published to npm yet (versions are bumped and
> ready — see [STATE.md](STATE.md) — but nobody has run the actual publish command). So "add ForgeCMS
> to _your own_ Analog app via `pnpm add`" isn't possible today. What **is** real today: a working CMS
> runtime, CRUD API with auth-protected writes, and admin UI, all wired together in this monorepo's
> demo app (`apps/www`). This guide uses that demo as the "Analog app" — clone the repo and you have a
> running Analog + ForgeCMS app in the time it takes to read this page. Everything below is
> copy-pasteable and was run against the real dev server while writing it.

## Prerequisites

- Node >= 22 (see `.nvmrc`)
- pnpm `10.11.0` (never npm/yarn — see [CLAUDE.md](../CLAUDE.md))
- git

## 1. Clone and install (2 min)

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd forge-cms
pnpm install
pnpm build   # required once — tsconfig path mapping resolves @forge-cms/* to packages/*/dist
```

## 2. Run the demo (1 min)

```sh
pnpm dev:www
```

Open the URL printed in your terminal (Analog's dev server, usually `http://localhost:5173`) and go
to `/admin`. You get a dashboard, 9 seeded collections (pages, posts, products, media, users,
categories, forms, navigation, site config), and full create/edit/delete with schema validation —
backed by an in-memory adapter that resets on every reload (that's expected in local dev; the
production deploy persists to Cloudflare D1). Reads are open to anyone; creating, editing, or
deleting a document requires logging in first at `/login` with the published demo credentials
(`demo@forgecms.dev` / `forgecms-demo`) — the UI redirects you there automatically on your first
write attempt.

## 3. Add your own collection (5 min)

This is the actual "add ForgeCMS to an app" step. Every collection lives in one file:
[apps/www/src/server/api/runtime.ts](../apps/www/src/server/api/runtime.ts). The HTTP routes
(`/api/v1/[collection]`) and the admin UI are both collection-agnostic — they read whatever is
registered here, so there is no second place to wire anything up.

Open that file and define a collection with `defineCollection` / `defineField`:

```ts
const testimonials = defineCollection({
  slug: 'testimonials',
  fields: {
    author: defineField.text({ required: true }),
    quote: defineField.textarea({ required: true }),
    rating: defineField.number(),
    featured: defineField.boolean()
  }
});
```

Add it to the `collections` array further down the same file:

```ts
const collections = [
  pages,
  posts,
  products,
  media,
  users,
  categories,
  forms,
  navigation,
  siteConfig,
  testimonials // 👈 new
];
```

Save. The dev server picks it up on the next request (the runtime is built lazily per-request, not
at startup — see the comment on `getServerRuntime` in that file). Reload `/admin/collections` in the
browser: "Testimonials" now appears alongside the seeded ones, with a working create/edit/delete
form generated from the field definitions above — no admin UI code was touched.

You can also drive it directly over HTTP. Writes require a Bearer token — log in first with the
published demo credentials:

```sh
# Log in (reads never need this — only create/update/delete do)
TOKEN=$(curl -s -X POST http://localhost:5173/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "demo@forgecms.dev", "password": "forgecms-demo"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.token))")

# Create
curl -X POST http://localhost:5173/api/v1/testimonials \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"author": "Ada", "quote": "It just works.", "rating": 5, "featured": true}'

# List (no token needed — reads stay open)
curl http://localhost:5173/api/v1/testimonials

# Filter by any field (equality, coerced to the field's type)
curl "http://localhost:5173/api/v1/testimonials?author=Ada"
```

Try posting with `author` omitted — you'll get a 400 with a validation error, because `required:
true` on the field DSL is enforced by `@forge-cms/core`'s `validateCollection` on every write. Try it
without the `Authorization` header at all — you'll get a 401, because writes are protected.

## Available field kinds

`text`, `number`, `boolean`, `date`, `relation` (`{ collection, many? }`), `json`, `select` (`{
options }`), `slug`, `email`, `textarea`. All support `required: true`; see
[packages/core/src/index.ts](../packages/core/src/index.ts) for the full option shapes.

## What you don't get yet

- **Real user management:** auth is one hardcoded demo user (`demo@forgecms.dev`), not a `users`
  collection with signup/roles/permissions — fine for a public demo, not for real multi-user data.
- **A standalone install:** see the callout at the top. Package versions are ready but nothing has
  been published to npm yet, so "using ForgeCMS" today means cloning this repo and editing
  `runtime.ts`, not `pnpm add`-ing packages into an app you already have.

## Where to go next

- [ARCHITECTURE.md](ARCHITECTURE.md) — how a request flows from the browser to the database adapter,
  and the contracts (`DatabaseAdapter`, `AuthAdapter`, `StorageAdapter`) you'd implement for a new backend.
- [STATE.md](STATE.md) — what's implemented vs. missing, package by package, and what's next.
