# CONVENTIONS — Code style, patterns, and pitfalls

> These are enforced by tsconfig/ESLint/CI where possible. Where not enforced, they are still
> mandatory — reviewers and agents should treat violations as bugs.

## TypeScript

- Strict mode plus two options that trip people up:
  - **`exactOptionalPropertyTypes: true`** — you cannot assign `undefined` to an optional property.
    Build objects with conditional spreads:
    ```ts
    const options = {
      collection,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset })
    };
    ```
  - **`noUncheckedIndexedAccess: true`** — `params?.['collection']` is `string | undefined`; guard
    before use (see the null checks at the top of every runtime handler).
- `import type { Foo } from '...'` for type-only imports (lint error otherwise).
- Relative imports inside `packages/*` use the **`.js` extension**: `from './validation.js'` — the
  packages compile with plain `tsc` as ESM and unsuffixed imports break at runtime.
- Node builtins via `node:` protocol (`node:fs`), though package runtime code should avoid Node-only
  APIs entirely (edge compatibility — see CONTEXT.md pillars).
- No floating promises: `await` it, `void` it deliberately (`void seedData(runtime)`), or `.catch()`.
- Avoid `any` (lint warns); prefer `unknown` + narrowing. `DatabaseRecord = Record<string, unknown>`
  is the standard loose-record type.

## Package rules (`packages/*`)

- `"type": "module"`, `sideEffects: false`, `files: ["dist"]`, exports map pointing at
  `dist/index.js` / `dist/index.d.ts` only.
- Every package has `build`, `test`, `test:watch`, `lint`, `typecheck`, `clean` scripts (copy from a
  sibling when creating a new one).
- Public API = whatever `src/index.ts` re-exports. Everything else is private. Don't deep-import
  another package's `src/` (exception: `@forge-cms/testing/contracts`, an official export).
- Cross-package deps use `workspace:*` in package.json AND a path mapping in `tsconfig.base.json`
  AND (for new packages) inclusion in the pnpm workspace — check all three when adding a package.
- Naming: kebab-case filenames with role suffixes — `*.adapter.ts`, `*.component.ts`, `*.page.ts`,
  `*.test.ts`, `schema-generator.ts`-style utility names.

## Error handling

- Runtime HTTP handlers **never throw across the boundary**: every handler body is wrapped in
  try/catch and returns the JSON error envelope (`{ error, details? }` + status). Follow this
  pattern for new handlers.
- Domain errors get typed error classes with a `code` field (see `ForgeAuthError` with
  `'unauthorized' | 'forbidden' | 'expired'`).
- Adapter methods throw `Error` with descriptive messages (`'D1DatabaseAdapter not initialized. Call init() first.'`);
  handlers translate them into 500 envelopes.

## Testing

- Vitest, colocated `*.test.ts` next to the source. Run a single package:
  `pnpm --filter @forge-cms/db test`.
- **Adapters:** import and run the contract suite, then add adapter-specific tests:
  ```ts
  import { runDatabaseAdapterContractTests } from '@forge-cms/testing/contracts';
  runDatabaseAdapterContractTests(() => new MyAdapter().init(env));
  ```
- Cloudflare adapters are tested against small hand-rolled mocks of D1/R2 bindings (see
  `packages/cloudflare/src/*.test.ts`) — no miniflare in unit tests.
- E2E (Playwright) only in `apps/www` (`pnpm e2e:www`); keep e2e for user-visible flows, not API logic.
- New logic ships with tests. Bug fixes ship with a regression test.

## Angular / Analog (apps and UI packages)

- Angular 21, **standalone components only**, `inject()` over constructor injection, signals for
  local state, `loadComponent` lazy routes.
- Styling: Tailwind CSS 4 (via `@tailwindcss/vite`). Reuse `@voltui/components` for UI primitives
  before writing new ones.
- Analog server routes: one file per method under `apps/www/src/server/routes/` —
  `[collection].get.ts`, `[collection].post.ts`, `[collection]/[id].put.ts`, etc., each a
  `defineEventHandler` that builds an `ApiContext` and delegates to a `@forge-cms/runtime` handler.
  **Keep route files thin**; behavior belongs in packages.
- Shared server state via `getServerRuntime()` (`apps/www/src/server/api/runtime.ts`) — seeding is
  lazy (triggered on first call from within a request handler), since Cloudflare Workers forbids
  async I/O at module scope; never call it or invoke async adapter I/O at module top level.

## Workflow & hygiene

- Branch from `main` (`feature/...`), PR into `main`; CI must pass (lint, typecheck, test, build; e2e
  and format:check run in separate workflows — run `pnpm format` before committing).
- Commit style in this repo: conventional-ish prefixes (`feat:`, `fix:`, `chore:`).
- **Changeset** (`pnpm changeset`) for any change under `packages/*`; commit the generated file.
- English everywhere in code, comments, and docs (some legacy Spanish comments exist — translate
  when touching those files).
- Definition of done for any task:
  1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green.
  2. Tests added/updated (contract suite for adapters).
  3. Changeset added if `packages/*` changed.
  4. `docs/STATE.md` updated if the status of anything changed.
  5. Spec status updated if working from a `docs/specs/` spec.

## Don'ts

- Don't use npm/yarn, CommonJS, or default exports.
- Don't add dependencies without a stated reason; packages currently have near-zero runtime deps —
  keep it that way (edge bundles).
- Don't change adapter contracts or the API envelope without a spec (see SDD.md).
- Don't edit `dist/`, `.analog/`, or generated files.
- Don't trust the README's status claims; trust `docs/STATE.md` and the code.
