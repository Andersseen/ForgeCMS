# 043 — Ship a developer documentation site at `/docs` in `apps/www`

- **Status:** in-progress
- **Author:** agent draft (requested by the maintainer: "generar docs para este proyecto, aprovechar
  www app, meter ahí una route de docs, aprovechar Analog.js y md")
- **Date:** 2026-07-27
- **Branch:** `main`
- **Affected packages/apps:** `apps/www`

## Context / Why

Everything a developer needs to use ForgeCMS today exists only as repo markdown aimed at
_maintainers_ (`docs/STATE.md`, `docs/ARCHITECTURE.md`, the 20 files in `docs/specs/`). A developer
arriving from the landing page gets a marketing page, a demo dialog and a GitHub link — there is no
"how do I define a collection / query it / deploy it" surface anywhere on the site. `docs/QUICKSTART.md`
is the closest thing and it is both repo-only and partly stale (it still claims auth is one hardcoded
demo user, fixed by spec 009).

The reference build is [volt-ui](https://github.com/Andersseen/volt-ui)'s docs site (sidebar +
grouped nav + content pane), but that site hand-writes every page as an Angular component. We have
Analog.js already, and its markdown content pipeline (`@analogjs/content`) turns `.md` files into
routed pages — so the docs can be prose in git, not components.

## Goal

`/docs` on `apps/www` serves a grouped, sidebar-navigated developer manual rendered from markdown
files in `apps/www/src/content/docs/`, so adding a page means adding one `.md` file.

## Non-goals

- A separate docs app or a separate deploy target. It rides `apps/www`'s existing Cloudflare Pages
  deploy.
- Replacing `docs/*.md` in the repo. `STATE.md`/`ARCHITECTURE.md`/`specs/` stay as the maintainer
  record; `/docs` is the consumer-facing manual and links out to them.
- Search, versioned docs, i18n, live code playgrounds, or an API reference generated from TypeScript
  types. All are viable later; none are needed to be useful.
- SSR/prerendering of the docs routes. `apps/www` runs `ssr: false` today and this spec does not
  change that (noted as a real SEO limitation in Outcome).
- Editing docs through the CMS itself. Tempting and on-brand, but it would make the docs undeployable
  from git and unreviewable in PRs.

## Design

### Content

Markdown lives in `apps/www/src/content/docs/<slug>.md`; the URL is `/docs/<slug>`. Frontmatter:

```yaml
---
title: Collections # <h1> and sidebar label
description: Define what a document is. # sub-title under the h1, and <meta description>
group: Content modelling # sidebar section; unknown groups sort last
order: 1 # sort within the group
---
```

`DocsFrontmatter` is declared once in `apps/www/src/app/pages/docs/docs-nav.ts` and is the only
contract a new page has to satisfy.

### Rendering pipeline

`analog({ content: { highlighter: 'prism' } })` in `vite.config.ts`. With a highlighter configured,
Analog's content plugin parses each `.md` **at build time** (marked + `marked-gfm-heading-id` +
Prism), so no markdown parser ships in the route's critical path and code blocks arrive already
tokenised. `provideContent(withMarkdownRenderer())` goes in `app.config.ts`; the page uses
`injectContent<DocsFrontmatter>({ param: 'slug', subdirectory: 'docs' })` and renders through
`<analog-markdown>`.

Prism emits `<span class="token …">`; the theme is ours, written in `styles.css` against the Volt
theme tokens so it follows light/dark instead of hardcoding one palette.

### Routes

```ts
{
  path: 'docs',
  loadComponent: () => import('./pages/docs/docs.page').then((m) => m.DocsPage), // shell: header + sidebar + outlet
  children: [
    { path: '', pathMatch: 'full', redirectTo: 'introduction' },
    { path: ':slug', loadComponent: () => import('./pages/docs/docs-article.page').then((m) => m.DocsArticlePage) }
  ]
}
```

The shell renders once, so navigating between pages swaps only the article — the sidebar keeps its
scroll position.

### Navigation

`docs-nav.ts` is pure and unit-tested — no Angular, no DI:

```ts
export interface DocsFrontmatter {
  title: string;
  description?: string;
  group?: string;
  order?: number;
}
export interface DocsNavLink {
  slug: string;
  title: string;
  description?: string;
}
export interface DocsNavGroup {
  heading: string;
  links: DocsNavLink[];
}

/** Frontmatter → sidebar model: known groups in GROUP_ORDER, then unknown ones alphabetically; links by `order` then title. */
export function buildDocsNav(files: DocsContentFile[]): DocsNavGroup[];
/** Flat reading order — what prev/next at the foot of an article walks. */
export function flattenDocsNav(groups: DocsNavGroup[]): DocsNavLink[];
export function findAdjacent(
  links: DocsNavLink[],
  slug: string
): { prev?: DocsNavLink; next?: DocsNavLink };
```

The component layer only calls `injectContentFiles()` and hands the result to these functions.

### Pages shipped

14 files, in four groups:

| Group             | Pages                                                         |
| ----------------- | ------------------------------------------------------------- |
| Getting started   | `introduction`, `quickstart`, `concepts`                      |
| Content modelling | `collections`, `fields`, `access-control`, `hooks`, `uploads` |
| Server APIs       | `local-api`, `rest-api`                                       |
| Client & deploy   | `angular-client`, `admin-ui`, `adapters`, `deployment`        |

Every code sample must be copied from or verified against the actual source — the docs describe what
`packages/*` does today, and say plainly when something is missing (no globals, no versions, no
localisation, nothing published to npm).

## Implementation plan

- [x] Add `@analogjs/content` + `marked`, `marked-gfm-heading-id`, `marked-mangle`,
      `marked-highlight`, `prismjs` to `apps/www`
- [x] `vite.config.ts`: `analog({ content: { highlighter: 'prism' } })`
- [x] `app.config.ts`: `provideContent(withMarkdownRenderer())`
- [x] `docs-nav.ts` (pure) + `docs-nav.test.ts`
- [x] `docs.page.ts` shell, `docs-sidebar.component.ts`, `docs-article.page.ts`
- [x] Prose + Prism token styles in `styles.css`
- [x] 14 markdown pages under `src/content/docs/`
- [x] "Docs" link in the site header and the hero CTA
- [x] `app.routes.ts` wiring
- [x] `escape-codespans.ts` + test (found during verification, see Outcome)
- [x] Header rework: drop the landing-page anchors, add a mobile hamburger
- [x] `e2e/docs.spec.ts`, `e2e/landing.spec.ts` updated
- [x] Quality gates + STATE.md

## Test plan

- Unit (`apps/www/src/app/pages/docs/docs-nav.test.ts`, Vitest): grouping order, `order`-then-title
  sorting, unknown-group fallback, prev/next including both ends of the list.
- Unit (`apps/www/vite-plugins/escape-codespans.test.ts`): escaping and entity preservation.
- e2e (`apps/www/e2e/docs.spec.ts`): the build-time pipeline — redirect, sidebar, Prism tokens
  present, no raw fences, generics surviving inline code, client-side navigation, mobile hamburger.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the full Playwright suite.

## Acceptance criteria

1. `/docs` redirects to `/docs/introduction` and every page in the sidebar renders its markdown.
2. Adding a `.md` file with valid frontmatter puts it in the sidebar with no TypeScript change.
3. Code blocks are syntax-highlighted and readable in both themes.
4. `buildDocsNav`/`findAdjacent` are unit-tested.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None.

## Outcome

Shipped as designed, plus two things the plan did not anticipate:

- **Analog's marked renderer does not escape inline code.** Its `codespan` returns
  `` `<code>${text}</code>` `` with the text raw, so `` `Promise<Post>` `` reached the DOM as a
  literal `<Post>` tag and vanished — in docs about a TypeScript API, that is most of the interesting
  identifiers, and it fails **silently**: no error, just missing words. Fixed by registering our own
  `codespan` renderer through the plugin's `markedOptions.extensions` (later extensions win), in
  `apps/www/vite-plugins/escape-codespans.ts`, with a unit test and an e2e assertion.
- **The site header was reworked** (maintainer request mid-implementation): the
  `#architecture`/`#packages`/`#roadmap` entries were anchors into the landing page, so they were
  meaningless in a header that now renders on `/docs` too. The nav is a single `Docs` link; the
  "See the demo" and GitHub buttons keep their place on the right, and there is a real hamburger
  below `md`. No `/admin` entry — the demo dialog already routes people there deliberately.
  `e2e/landing.spec.ts` was rewritten to match, and the GitHub URL was corrected to
  `Andersseen/ForgeCMS` (it pointed at a repo that does not exist).

Two things worth knowing for whoever picks this up next:

- **No SSR.** `apps/www` is `ssr: false`, so docs pages are client-rendered and invisible to crawlers
  that do not execute JS. Turning SSR on for `/docs` is the single highest-value follow-up, and it is
  the same blocker DEMO-FINDINGS calls out for content sites.
- **No table of contents.** With the build-time (Prism) pipeline, `injectContent`'s `toc` comes back
  empty — marked runs over already-rendered HTML at runtime, so `marked-gfm-heading-id` has no
  markdown headings to collect. Heading `id`s _are_ in the HTML (they are generated at build time),
  so an "On this page" rail can be derived from the DOM or by parsing the HTML later.
