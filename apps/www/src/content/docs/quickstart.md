---
title: Quickstart
description: From clone to your own collection, with a working API and admin UI.
group: Getting started
order: 2
---

> **Read this first:** no `@forge-cms/*` package is published to npm yet, so you cannot
> `pnpm add @forge-cms/core` into an existing app. Using ForgeCMS today means cloning the monorepo
> and building inside it. Everything below runs against the real dev server.

## Prerequisites

- Node >= 22 (`.nvmrc`)
- pnpm 10.11.0 — never npm or yarn, the workspace depends on pnpm's linking
- git

## 1. Clone and build

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build   # required once: @forge-cms/* resolves to packages/*/dist
```

`pnpm build` is not optional on a fresh clone. TypeScript path mapping points `@forge-cms/*` at
`packages/*/dist/index.d.ts`, so `pnpm typecheck` fails until the packages have been built once.

## 2. Run an app

```sh
pnpm dev:www     # landing page + /admin + the CRUD API
pnpm dev:demo    # a full marketing site built on the CMS (apps/demo-aesthetics)
```

Open the printed URL and go to `/admin`. Reads are public; creating, editing and deleting require a
login at `/login`:

| App                    | Email                    | Password        | Role   |
| ---------------------- | ------------------------ | --------------- | ------ |
| `apps/www`             | `demo@forgecms.dev`      | `forgecms-demo` | admin  |
| `apps/demo-aesthetics` | `demo@lumea.clinic`      | `lumea-demo`    | admin  |
| `apps/demo-aesthetics` | `frontdesk@lumea.clinic` | `lumea-desk`    | editor |

Local development uses in-memory adapters, so **data resets on every reload**. That is expected;
the deployed apps persist to Cloudflare D1.

## 3. Add a collection

Everything lives in one file — `apps/www/src/server/api/runtime.ts`. The HTTP routes and the admin
UI are collection-agnostic: they read whatever is registered there, so there is no second place to
wire anything up.

```ts
const testimonials = defineCollection({
  slug: 'testimonials',
  fields: {
    author: defineField.text({ required: true }),
    quote: defineField.textarea({ required: true }),
    rating: defineField.number({ min: 1, max: 5 }),
    featured: defineField.boolean({ defaultValue: false })
  }
});
```

Add it to the `collections` array in the same file:

```ts
const collections = [pages, posts, products, media, users, categories, testimonials];
```

Save. The runtime is built lazily per request, so the next request picks it up — reload
`/admin/collections` and "testimonials" is there, with a working create/edit/delete form generated
from those field definitions. No admin code was touched.

## 4. Drive it over HTTP

Reads are open. Writes need a bearer token:

```sh
# Log in
TOKEN=$(curl -s -X POST http://localhost:5173/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@forgecms.dev","password":"forgecms-demo"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.token))")

# Create
curl -X POST http://localhost:5173/api/v1/testimonials \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"author":"Ada","quote":"It just works.","rating":5,"featured":true}'

# List, filter, sort, paginate — no token needed
curl "http://localhost:5173/api/v1/testimonials?featured=true&sort=rating&order=desc&limit=10"
```

Post without `author` and you get a `400` with a per-field validation error, because `required: true`
is enforced by `@forge-cms/core` on every write. Post without the `Authorization` header and you get
a `401`.

## 5. Query it from server code

The HTTP API is for clients. From an Analog server route, skip it and call the
[Local API](/docs/local-api) directly:

```ts
// apps/www/src/server/routes/api/site/testimonials.get.ts
import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  const { docs } = await runtime.find({
    collection: 'testimonials',
    where: { featured: true },
    sort: 'rating',
    order: 'desc',
    limit: 3
  });

  return docs;
});
```

Same pipeline — validation, hooks, access, drafts — with no HTTP hop and no `Request` to fabricate.

## 6. Query it from the browser

```ts
import { Component, inject, signal } from '@angular/core';
import { CmsApiService } from '@forge-cms/angular';

@Component({ selector: 'app-testimonials', template: '…' })
export class TestimonialsComponent {
  private readonly cms = inject(CmsApiService);
  readonly testimonials = signal<Record<string, unknown>[]>([]);

  async ngOnInit() {
    const { docs } = await this.cms.listDocuments('testimonials', {
      where: { featured: true },
      sort: 'rating',
      order: 'desc',
      limit: 3
    });
    this.testimonials.set(docs);
  }
}
```

`provideForgeCms({ baseUrl: '/api/v1' })` is already in `app.config.ts`. See
[Angular client](/docs/angular-client) for the signal-based `collectionResource` version of the same
thing.

## Next

- [Core concepts](/docs/concepts) — what the runtime, adapters and Local API actually are.
- [Fields](/docs/fields) — every field kind and its options.
- [Deployment](/docs/deployment) — shipping it to Cloudflare with D1 and R2.
