# 104 — Add admin landmarks, a skip link and a keyboard journey gate

- **Status:** in-progress
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-a11y-landmarks` (stacked on spec 103's `feat/admin-angular-22`)
- **Affected packages/apps:** `@forge-cms/admin` (templates only), `scripts/ssr-consumer` (journey), docs
- **Release:** part of **1.1.0** (fixed group). This change alone is a patch.

## Context / Why

[LIMITATIONS.md](../LIMITATIONS.md) records a known gap, found in the L02 observation and present since 0.13.4: the admin shell has no `<main>`/`<nav>` landmark and no skip link, and the sidebar precedes the content. V2-01 asks to close it and to prove the full keyboard journey (login → list → edit → save → logout) and dialog focus on Angular 21 and 22.

## Goal

A keyboard or screen-reader user can skip straight to the content, recognise the page regions, and complete the core admin journey with the keyboard alone. A packed e2e on both Angular majors proves it.

## Compatibility impact

**Backward compatible.** No export, input, route, default or REST change (`api-baseline/*` unchanged). Only rendered markup changes:

- New elements: one skip link (first focusable in the shell), `<nav aria-label="Admin">` around the sidebar groups, `<nav aria-label="Breadcrumb"><ol><li>` around the breadcrumbs.
- `role="main"` on the existing page-content `div` (now `id="forge-admin-main"`, `tabindex="-1"`) and on the sign-in/sign-up page wrappers. The role is **dropped in the browser when the host already wraps the admin in a `main` landmark**, so a 1.0 host that did this does not gain a nested-`main` violation.
- "Log in" and "Exit" become single `<a>` elements (styled as ghost buttons) instead of `<a>` wrapping `<volt-button>`. Same text, same destination, one Tab stop. Selectors written against the inner `<button>` would no longer match. The admin's DOM below the documented components was never part of the stable surface ([SUPPORT.md](../SUPPORT.md)).
- `<volt-sidebar-item>` hosts get `tabindex="-1"`. `[routerLink]` on them also matched Angular's `RouterLink` (imported by the layout), which gave each entry a second, empty Tab stop.

## Non-goals

- No visual redesign. No new configuration option for landmarks.
- No banner/`<header>` landmark: the admin is often mounted inside a host page that already has one, and duplicate banners are their own violation.
- No changes inside `@voltui/components` (see Upstream notes).
- Dialog focus logic is unchanged: `ForgeModalFocusDirective` (spec 086) already traps focus, sends it to the safe choice and restores it. This spec adds e2e proof on both Angular majors.

## Design

### Shell (`layout.component.ts`)

```html
<a class="forge-admin-skip-link" href="#forge-admin-main" (click)="skipToMain($event)"
  >Skip to main content</a
>
<div class="h-dvh flex …">
  <volt-sidebar>
    … <volt-sidebar-content><nav aria-label="Admin">groups</nav></volt-sidebar-content> …
  </volt-sidebar>
  <div class="flex-1 …">
    <div class="h-14 …">
      …
      <nav aria-label="Breadcrumb">
        <ol>
          …<span aria-current="page">Dashboard</span>
        </ol>
      </nav>
      …
    </div>
    <div #main forgeMainLandmark id="forge-admin-main" tabindex="-1" class="…">
      <router-outlet />
    </div>
  </div>
</div>
```

- **Skip link:** visually hidden until focused, styled in the component (not utility classes) so it works in any host. A plain `#id` link resolves against `<base href>` and would leave the admin, so the click handler prevents the default, focuses the main region and scrolls it into view.
- **Focus after navigation:** after an in-shell `NavigationEnd` (not the first), if focus is on `<body>`, nowhere, or a disconnected node, it moves to the main region (`preventScroll`). Focus a page set itself (an autofocused field, a restored dialog opener) is left alone.
- **Breadcrumbs:** an ordered list; the chevrons are `aria-hidden`; the unlinked last crumb is `aria-current="page"`. Linked crumbs stay links.

### `ForgeMainLandmarkDirective` (internal, not exported)

`[forgeMainLandmark]` binds `role="main"` on its host. After the first browser render it removes the role if `host.parentElement.closest('main, [role="main"]')` exists. Used by the layout, sign-in and sign-up.

### Gate: keyboard journey (`scripts/ssr-consumer/journey.mjs`, step 10k)

Runs on every tuple the journey runs on (`release:certify` stage `s3` for Angular 21 on both profiles; stage `admin-22` for Angular 22). A fresh browser context sends no pointer events:

1. `/studio/login`: Tab to email, type, Tab to password, type, Enter → `/studio/collections`.
2. Tab reaches the skip link. Enter focuses `role="main"` without leaving the page.
3. Tab from the main region reaches the posts link in the collections index. Enter.
4. Tab to "Edit ‹title›". Enter. axe scan of the editor. Tab to the title field, replace it, Tab to Save, Enter. The list shows the new title.
5. Tab to "Delete ‹title›". Enter. Focus is inside the dialog; axe scan with the dialog open; six Tabs stay inside; Escape closes it; focus is back on the Delete button; the row still exists.
6. Tab to "Log out". Enter → `/studio/login`.

`tabTo` fails with the list of visited stops when a target is unreachable, so a keyboard regression reports exactly where focus went. The axe tag set and the single `target-size` exclusion are those of spec 086 (unstyled fixture); `apps/demo-aesthetics` runs `target-size` unexcluded.

## Implementation plan

- [x] `ForgeMainLandmarkDirective`; landmarks, skip link, focus-after-navigation, breadcrumb list in the layout
- [x] single-element "Log in" / "Exit"; `tabindex="-1"` on sidebar item hosts
- [x] `role="main"` on sign-in / sign-up
- [x] unit tests `layout.accessibility.test.ts` (landmarks, skip link, single Tab stops, focus after navigation, nested host `main`, sign-in landmark)
- [x] keyboard journey + axe on the editor and an open dialog, on 21 and 22
- [x] LIMITATIONS.md row removed; changeset; STATE.md

## Test plan

- `pnpm --filter @forge-cms/admin test` (incl. `layout.accessibility.test.ts`)
- `pnpm release:ssr:admin-22` and the Angular 21 journey (`FORGE_SSR_TUPLE=angular-21 FORGE_SSR_PROFILES=cloudflare node scripts/verify-ssr-consumer.mjs journey`)
- `pnpm e2e:tiny-project`, `pnpm e2e:demo` (the styled axe scans include `target-size`)
- full gates

## Acceptance criteria

1. The shell has exactly one `main` landmark containing the routed page, and labelled `Admin` and `Breadcrumb` navigation. Inside a host `<main>` it adds none.
2. The skip link is reachable by Tab, and Enter focuses the main region without navigating.
3. The keyboard-only journey (above) passes on Angular 21.2.10 and 22.2.6, and axe reports zero WCAG 2.2 A/AA violations on every scanned state.
4. Existing e2e suites (tiny-project, demo-aesthetics) pass. `api-baseline/*` unchanged.
5. LIMITATIONS.md no longer lists the landmark gap.

## Evidence (2026-11-17, local)

- `@forge-cms/admin` unit tests: 8 new layout accessibility tests pass. The whole package passes.
- Keyboard journey + axe (collections, posts, users, login, editor, open dialog): passed on Angular 22.2.6 / Analog 2.9.7 and on Angular 21.2.10 / Analog 2.5.2 (Cloudflare Pages output under local workerd + D1 + R2).
- `pnpm e2e:tiny-project` 27/27; `apps/demo-aesthetics` accessibility 3/3.
- Found by the gate: the double Tab stop on every sidebar entry (fixed here), and the collections index renders its links only after loading (the gate waits for them).

## Upstream notes

- **Volt UI:** `volt-sidebar-item` renders `routerLinkActive` without `ariaCurrentWhenActive`, so the active entry is not announced as the current page. Suggest `ariaCurrentWhenActive="page"`. Also, an input named `routerLink` on a component host collides with Angular's `RouterLink` in any template that imports it. Suggest renaming it or documenting the collision.
- **Lumen Icons:** nothing new.

## Outcome

<!-- Fill when merged. -->
