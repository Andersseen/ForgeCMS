---
'@forge-cms/admin': minor
---

Reliable content state and failure recovery in the reusable admin (spec 085, roadmap 0.11 / U01).
The document editor saves once (a visible "Saving…" state, no duplicate writes), keeps the form and
unsaved-changes flag after any failed save, and starts a clean draft when the document changes. The
collection workspace keeps search/filter/sort/page across editor round trips, resets them for another
collection, and isolates late delete/publish responses; deleting and publishing report the real
outcome (a failed delete keeps its dialog as the retry path). The users workspace is latest-wins,
single-write, keeps its form on failure and shows friendly errors. A session expiry no longer erases
unsaved edits, and a `403` re-reads the live role through `ForgeAuthSession`.

Additive component inputs: `ForgeCollectionFormComponent` `submitting`/`submitDisabled`,
`ForgeConfirmDialogComponent` `pending`/`pendingLabel`/`error`, `ForgeCollectionListComponent`
`pendingIds`.
