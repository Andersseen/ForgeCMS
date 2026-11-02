# 101 — Localize the public website with Glossa and Etyma

- **Status:** in-progress
- **Author:** agent draft
- **Date:** 2026-11-02
- **Branch:** `feat/www-i18n-glossa-etyma`
- **Affected packages/apps:** `apps/www` only (no `packages/*`, no public API, no changeset)

## Context / Why

The official site (`apps/www`) was English-only. ForgeCMS's audience includes Spanish- and
Ukrainian-speaking Angular developers, and the owner maintains two tools built for exactly this:
**Glossa** (translation management, MCP, public catalog delivery) and **Etyma** (typed i18n runtime
for Angular/Analog). This first increment makes the public marketing site fully trilingual and the
docs shell localizable, without redesigning anything or touching the CMS packages.

## Goal

`forgecms.dev` serves English, Spanish and Ukrainian public pages whose prerendered HTML is already
translated, with catalogs managed in Glossa, rendered by Etyma, and metadata that names only real
translations.

## Non-goals

- More locales than `en`, `es`, `uk`; internationalizing CMS package APIs or the `/admin` UI.
- Translating all 25 docs articles (three are translated: `introduction`, `quickstart`,
  `small-project-guide`); the Lumea demo app's own content.
- A translation backend in ForgeCMS, a custom i18n engine, or a custom Glossa webhook.
- A Cloudflare deploy-hook change (needs the owner; see "Delivery").

## Design

### Packages

`@etyma/core@1.0.0` and `@etyma/angular@1.0.0` (runtime), `@etyma/tooling@1.0.0` (dev only).
**`@etyma/analog` is not used:** it peers on `@analogjs/router >= 2.6` (www is on Analog 2.5.2 with
Angular's own `provideRouter`), `withLocalizedRoutes()` is a file-router feature, and its SEO emits an
`hreflang` for every locale — which would advertise docs translations that do not exist. Upgrading
Analog would not remove the last two reasons, so the site uses the extension points
`@etyma/angular` documents for a custom router integration instead.

### Locale model and routing

- `src/app/i18n/site-locales.mjs` (shared by the app and the Node build scripts): `SITE_LOCALES`,
  endonyms, `og:locale`, `pageLocales(path, translatedDocs, englishDocs)`; prefix handling is Etyma's
  `createLocaleRouter`.
- The URL is the only source of truth: English unprefixed, `/es/*`, `/uk/*`. Nothing is stored.
- `localizedRoutes(pages, outside)` (`i18n/locale-routing.ts`) builds one route tree:
  `/en/**` → redirect to the unprefixed URL (query/fragment kept); `/:locale/**` with a `canMatch`
  that admits only `es`/`uk` and a `canActivate` that `activate()`s the locale **before** the page
  renders; `outside` (admin, English-only); the unprefixed English branch. Both branches share the
  same `pages` array, so lazy pages load once.
- `provideLocaleSwitch()` provides `ETYMA_LOCALE_SWITCH`: `setLocale()` is a navigation.
- Static hosting: `public/_redirects` adds `/en → /`, `/en/* → /:splat`, `/{es,uk}/docs →
…/introduction`. Unknown paths stay Pages' native 404.

### Catalogs and delivery

- Glossa project `forge-cms` (slug read from `get_project`) holds the catalogs. Public Delivery is
  enabled: `https://glossa.andersseen.dev/i18n/forge-cms/{manifest,en,es,uk}.json`.
- `src/app/i18n/catalogs/{en,es,uk}.json` is a **generated snapshot** of Glossa (the README there
  says so); English is Etyma's source and type contract, `es`/`uk` are lazy chunks of the build.
  `contract.generated.ts` (Etyma's `renderContractModule`) types `t()` params.
- `scripts/i18n-catalogs.mjs`:
  - `check` (runs in every `build`): Etyma `validateCatalogs` (key parity, MF2 syntax, variable
    parity, locale names) + "every site locale present" + contract matches `en.json`.
  - `pull`: Public Delivery → validate → contract must equal the committed one (a key change needs a
    PR) → write the snapshot. Any failure exits non-zero.
  - `push`: snapshot → Machine API with `If-None-Match: *`; never overwrites an existing catalog.
- Glossa stores strings and objects only (no arrays), so list messages are numbered objects
  (`"0"`, `"1"`…), which Etyma flattens exactly like arrays.
- **How an edit reaches the site:** edit in Glossa → run the CI workflow on `main` manually (or push
  any commit) → the deploy job runs `i18n:pull`, then builds and deploys. A pull that fails
  validation fails the deploy. Glossa's deploy hook cannot trigger this (it accepts only Cloudflare
  build-hook URLs; this project deploys by direct upload from GitHub Actions).
- No runtime request to Glossa and no token anywhere in the app, its HTML or its assets.

### Rendering, hydration and head

- Prerender: each page once per locale it exists in (`scripts/public-routes.mjs` feeds both the
  prerender list and the sitemap) — 9 marketing pages + 25 English docs + 6 translated docs.
- Etyma writes the active locale and its catalog to `TransferState`; the browser hydrates with it,
  so there is no second catalog fetch and no English flash.
- `SiteHeadService` is the single owner of `<html lang/dir>`, title/description (route `seo` keys),
  canonical (self for real pages; English original for an untranslated docs URL reached in-app),
  `og:url`, `og:locale(:alternate)`, and `hreflang` + `x-default` **only for locales the page exists
  in**. Tags are updated in place; client navigation never duplicates them.
- Inline markup in translations uses MF2 markup (`{#code}`, `{#strong}`, `{#link}`) rendered from
  `parts()` by `RichMessageComponent` — never `innerHTML`.

### Docs

- Translations live in `src/content/<locale>/docs/<slug>.md` (distinct content ids; Analog's
  `withLocale` is not used because it falls back to English silently). Frontmatter `group`/`order`
  stay English (they drive ordering); title/description are translated. Code blocks are
  byte-identical to English.
- Under `/es/docs` and `/uk/docs` the sidebar keeps the English order, uses translated titles where
  they exist, and links the rest to the English article with an `EN` marker. A translated URL with
  no translation is never linked, prerendered or listed; reached in-app, it shows an honest
  "not translated yet" notice (noindex, 404).

### Switcher, analytics

- `LanguageSwitcherComponent` (Volt `DropdownMenu`): endonyms, `aria-current` on the active one,
  same page when it exists (query kept; fragment kept except between docs translations), otherwise
  the target locale's docs home / home, labelled as such.
- Umami: `isPublicAnalyticsPath` also accepts `/es/*` and `/uk/*` public pages; the reported path
  keeps the locale prefix; consent handling is unchanged.

## Test plan

- Unit: `site-locales`, `language-targets`, `message-segments`, `catalog-validation` (Etyma
  validation, contract sync, MF2 plurals incl. Ukrainian), `locale-routing` (TestBed router:
  prefixes, `/en` redirect, unknown locales, admin, `setLocale()`), docs nav/labels, Umami paths;
  existing content tests resolve keys through the English catalog.
- `e2e-prod/i18n.spec.ts` (workerd, production build): translated HTML without JS, alternates,
  English-only docs, 404s, `/en` redirects, sitemap, hydration without catalog fetch, client
  navigation, switcher (mouse, keyboard, fallback, history), theme persistence, four widths.

## Acceptance criteria

1. `GET /es` and `GET /uk` return Spanish/Ukrainian HTML with correct `lang`, title, description,
   canonical, `og:*` and four `hreflang` links; no English UI copy before JavaScript.
2. `/en/*` → 301 to unprefixed; `/fr` and `/es/docs/fields` → 404.
3. The sitemap lists 40 URLs: marketing pages ×3, 25 English docs, 3 translated docs ×2.
4. Hydrating `/es` requests no catalog chunk and logs no errors.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `pnpm e2e:www:prod` green.

## Open questions

- Owner: add `es` and `uk` to the Glossa project's locales, then `pnpm --filter @forge-cms/www i18n:push`
  creates both catalogs; until then the deploy job's `i18n:pull` fails by design.
- Native-speaker review of the Spanish and Ukrainian copy has not happened.

## Outcome

<!-- Fill when done. -->
