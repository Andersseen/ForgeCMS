---
'@forge-cms/angular': minor
---

Give the client a real query API (spec 041).

- `getDocuments`/`listDocuments`/`getDocument` accept `QueryOptions`: `where` (with operators),
  `sort`, `order`, `limit`, `offset`, `page`, `depth` and `status`. `listDocuments` returns the
  pagination metadata (`totalDocs`, `page`, `totalPages`, `hasNextPage`, `hasPrevPage`).
- **Reads now send the auth token.** They never did, so a signed-in editor was anonymous to every
  `GET` — which is why the admin could not see drafts and field-level read access always resolved as
  logged-out.
- `uploadFile(collection, file, fields)` for the multipart path the server has supported since spec 016.
- Signal-based reads: `collectionResource()` and `documentResource()`.
- `buildQueryString` is exported so paginators and filter links produce the same strings.
- The package is now a barrel over `types`/`query`/`api.service`/`resources`; every previous export
  keeps its name and shape.
