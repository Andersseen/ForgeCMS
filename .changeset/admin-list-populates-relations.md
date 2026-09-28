---
'@forge-cms/admin': patch
---

The reusable collection workspace (`forgeAdminContentRoutes()`) now lists documents with `depth: 1`,
so relation and upload columns show the related document's title and the image thumbnail instead of
a truncated id. Spec 042 had this on the app-local list that spec 052's workspace replaced; found by
moving `apps/demo-aesthetics` onto the package routes (spec 071).

Also from the same dogfood pass:

- Wide collection lists and the users table scroll inside the content area instead of widening the
  whole page (a `services` list overflowed a 390 px viewport by 700 px).
- The layout's sidebar-collapse and theme buttons have accessible names. The theme toggle's label sat
  on the `<volt-button>` host, which Volt 1.0.x does not forward to the native button.
- Boolean fields in the document form render a switch named after the field; its `<label>` did not
  reach Volt's inner switch button, so it had no accessible name.
