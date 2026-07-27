---
'@forge-cms/admin': minor
'@forge-cms/runtime': patch
'@forge-cms/angular': patch
---

Make the admin usable by someone who is not a developer (spec 042).

- List cells render per field kind: richtext as prose (it used to read `[object Object]`), relations
  and uploads by label or thumbnail instead of a raw UUID, composite fields as a count.
- Collections with `drafts: true` get a status badge column and publish/unpublish in place.
- Sorting and pagination controls, driven by the caller's query.
- `ForgeRelationPickerComponent`: searches the target collection server-side instead of asking the
  editor to paste a UUID.
- `ForgeUploadPickerComponent`: preview, upload, and a library grid.
- `ForgeRichTextEditorComponent`: edits the node tree as text blocks, with a JSON fallback for
  documents it cannot represent. No new runtime dependency.
- `ForgeAdminConfig.nav` makes the sidebar configurable (`DEFAULT_ADMIN_NAV` keeps today's items).
- `describeCollection` reports `drafts`/`upload` and derives readable labels
  (`durationMinutes` → `Duration minutes`).
- Forms normalise populated relation/upload values back to ids, so a list fetched with `depth: 1`
  can be edited without writing objects into id columns.
