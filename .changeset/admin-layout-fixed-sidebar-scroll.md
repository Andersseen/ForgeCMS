---
'@forge-cms/admin': patch
---

`ForgeAdminLayoutComponent`: the sidebar and top header bar now stay fixed while only the page content
scrolls, instead of the whole admin shell (sidebar included) scrolling together on a tall page — found
on the Clinic settings page in `apps/demo-aesthetics`, which has enough fields to overflow the viewport.
The outer shell moved from `min-h-screen` (grows with content) to `h-dvh overflow-hidden` (pinned to the
viewport); the header gained its own bounded, non-scrolling region, and only the `<router-outlet>`
content area scrolls (`overflow-y-auto` with `min-h-0`, the standard fix for a flex child that needs to
shrink below its content's natural height). No template structure or public API changed — CSS only.
Affects every consumer of `@forge-cms/admin`'s shared admin shell (`apps/www`, `apps/demo-aesthetics`,
`apps/tiny-project`); `e2e:www`/`e2e:demo`/`e2e:tiny-project` re-run and pass.
