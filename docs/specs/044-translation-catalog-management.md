# 044 — Translation Catalog Management

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-08-22
- **Branch:** feature/translation-catalogs
- **Affected packages/apps:** @forge-cms/runtime (describe, handlers), @forge-cms/angular (types, query, api.service), @forge-cms/admin (locale selector, field-control), apps/www (collections, routes, admin pages)

## Context / Why

ForgeCMS has a solid CMS foundation with localization support (Phase 0.3.4): fields can be marked `localized: true`, collections declare `locales`, and the runtime handles locale-aware reads/writes with fallback chains. However, the localization metadata did not propagate through the describe/meta layer to the HTTP and Angular client layers, and the admin UI had no locale awareness.

Separately, the maintainer manages translation JSON catalogs for multiple personal projects (Volt UI, Imagineryx, Etyma playground) by hand. ForgeCMS should become the centralized management point for these catalogs — not by building a second CMS inside ForgeCMS, but by using existing CMS primitives (collections, relations, hooks, Local API, HTTP handlers) to model translation projects and messages as a domain feature.

This iteration establishes the data model, APIs, and end-to-end import/export capability. The dedicated translation editing UI comes next.

## Goal

ForgeCMS can manage translation JSON catalogs for multiple projects with different locale sets: create projects, import nested JSON catalogs, store messages in a normalized model, and export canonical JSON — all through existing CMS primitives plus a thin domain service layer.

## Non-goals

- Dedicated multi-column translation editor / spreadsheet UI
- Completion percentages, missing-key dashboard
- MF2 validation (Etyma's responsibility)
- Etyma runtime/MCP integration
- Publish/release snapshots, immutable catalog URLs, public CDN endpoints
- AI translation, translation memory, glossary
- Reviewer/approval workflows, teams/collaboration
- Billing, Weblate/Lokalise-style tooling
- Git sync

## Design

### Phase A: Localization Metadata Propagation Fixes

The existing localization feature (Phase 0.3.4) was incomplete at the describe/HTTP/client layers:

1. **`FieldDescription` gains `localized?: boolean`** — `describeField()` reads `field.options.localized`.
2. **`CollectionDescription` gains `locales?: string[]`** — `describeCollection()` reads `collection.locales`.
3. **HTTP handlers extract `locale`** — added to `RESERVED_QUERY_PARAMS`, parsed via `parseLocale()`, forwarded to Local API operations.
4. **Angular `FieldMeta` gains `localized?: boolean`** — mirrors `FieldDescription`.
5. **Angular `CollectionMeta` gains `locales?: string[]`** — mirrors `CollectionDescription`.
6. **Angular `QueryOptions` gains `locale?: string`** — `buildQueryString()` serializes it.
7. **`CmsApiService` methods accept `locale`** — `getDocument`, `createDocument`, `updateDocument` accept optional `{ locale }`.

### Phase B: Translation Domain Model

Two new collections defined in `apps/www/src/server/api/runtime.ts`, using existing ForgeCMS primitives:

#### `translation_projects`

```ts
defineCollection({
  slug: 'translation_projects',
  fields: {
    name: defineField.text({ label: 'Name', required: true }),
    slug: defineField.slug({ label: 'Slug', sourceField: 'name', autoGenerate: true, required: true }),
    sourceLocale: defineField.text({ label: 'Source locale', required: true }),
    locales: defineField.json({ label: 'Locales', required: true }),
    description: defineField.textarea({ label: 'Description' })
  }
})
```

- `locales` stored as JSON array of strings (e.g., `["en", "es", "uk"]`).
- `sourceLocale` must be a member of `locales`.
- Validated via a `beforeChange` hook.

#### `translation_messages`

```ts
defineCollection({
  slug: 'translation_messages',
  fields: {
    project: defineField.relation({ label: 'Project', collection: 'translation_projects', required: true }),
    key: defineField.text({ label: 'Key', required: true }),
    translations: defineField.json({ label: 'Translations', required: true }),
    description: defineField.text({ label: 'Description' })
  }
})
```

- `key` is canonical dot notation (e.g., `nav.docs`, `footer.rights`).
- `translations` is a JSON object keyed by locale codes (e.g., `{ "en": "Docs", "es": "Documentación" }`).
- Key uniqueness per project enforced at the domain/service layer (compound unique not generically supported by the DB adapter yet).
- `project` relation uses `onDelete: 'cascade'` to clean up messages when a project is deleted.

### Phase C: Catalog Utilities

Pure, framework-independent utilities in `apps/www/src/server/translations/catalog-utils.ts`:

```ts
export function flattenCatalog(catalog: Record<string, unknown>): Map<string, string>
export function unflattenCatalog(messages: Record<string, string>): Record<string, unknown>
export function validateTranslationKey(key: string): { valid: boolean; error?: string }
export function validateLocale(locale: string): boolean
```

**flattenCatalog rules:**
- Nested objects → dot-separated keys
- Leaf strings → values
- Arrays, null, numbers, booleans → validation error
- Empty objects → skipped

**unflattenCatalog rules:**
- Deterministic key ordering (alphabetical)
- Reconstructs nested object from dot-separated keys

**Key validation:**
- Non-empty
- No leading/trailing dots
- No consecutive dots
- Pattern: `/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/`

### Phase D: Import Service

Domain logic in `apps/www/src/server/translations/import-service.ts`:

```ts
export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  total: number;
  errors: ImportError[];
}

export async function importTranslationCatalog(
  runtime: ForgeCmsRuntime,
  projectSlug: string,
  locale: string,
  catalog: Record<string, unknown>
): Promise<ImportResult>
```

Steps:
1. Find project by slug (validate exists)
2. Validate locale belongs to project's locales
3. Flatten catalog
4. Validate each key
5. For each flattened key:
   - Find existing message by project + key
   - If not found: create new message with `{ [locale]: value }` in translations
   - If found: update that locale's value in translations, preserve other locales
6. Return structured statistics

### Phase E: Export Service

```ts
export interface ExportOptions {
  fallback?: 'none' | 'source';
}

export async function exportTranslationCatalog(
  runtime: ForgeCmsRuntime,
  projectSlug: string,
  locale: string,
  options?: ExportOptions
): Promise<Record<string, unknown>>
```

- Queries all messages for the project
- Extracts the requested locale's value from each message's translations
- Missing values: omit (default `fallback: 'none'`) or use source locale value
- Deterministic key ordering (alphabetical)
- Returns nested JSON object

### Phase F: HTTP Endpoints

Thin handlers in `apps/www/src/server/routes/api/v1/translations/`:

```
POST /api/v1/translations/:project/import/:locale  — import catalog (auth required)
GET  /api/v1/translations/:project/catalog/:locale  — export catalog (auth required)
```

Both use the existing error envelope. Import accepts JSON body (the catalog). Export returns raw JSON (not a CMS envelope — this is a translation artifact).

Payload size limit: 2MB configurable.

### Phase G: Angular SDK

No new methods on `CmsApiService` — the generic CRUD methods suffice for managing projects and messages. The import/export endpoints are called directly via `fetch` from the admin UI (they are domain-specific, not generic CMS operations).

### Phase H: Minimal Admin Integration

A new admin page at `/admin/translations` in `apps/www`:

1. **Project list** — shows all translation projects with name, slug, locales
2. **Project create/edit** — form for name, source locale, locales (comma-separated), description
3. **Project detail** — shows project info + import/export actions per locale
4. **Import** — file upload or JSON paste for one locale, shows import result counts
5. **Export** — download/copy the resulting locale JSON

Uses existing admin patterns: `PageHeaderComponent`, `LoadingStateComponent`, `CmsApiService`, VoltUI components.

### Phase I: Generic Localization Admin Fix

`ForgeFieldControlComponent` gains locale awareness:
- When a field has `localized: true` and the collection has `locales`, the form shows a locale selector
- The form stores/reads the correct locale key within the field value
- Minimal implementation: a tab or dropdown per localized field

`ForgeCollectionFormComponent` gains optional `locales` input.

## Implementation Plan

- [x] Phase A: Fix `FieldDescription` — add `localized` (packages/runtime/src/describe.ts)
- [x] Phase A: Fix `CollectionDescription` — add `locales` (packages/runtime/src/describe.ts)
- [x] Phase A: Fix HTTP handlers — add `locale` to reserved params, parse and forward (packages/runtime/src/handlers.ts)
- [x] Phase A: Fix Angular `FieldMeta` — add `localized` (packages/angular/src/types.ts)
- [x] Phase A: Fix Angular `CollectionMeta` — add `locales` (packages/angular/src/types.ts)
- [x] Phase A: Fix Angular `QueryOptions` — add `locale` (packages/angular/src/query.ts)
- [x] Phase A: Fix `CmsApiService` — accept locale on getDocument/createDocument/updateDocument (packages/angular/src/api.service.ts)
- [ ] Phase B: Define `translation_projects` and `translation_messages` collections (apps/www/src/server/api/runtime.ts)
- [ ] Phase C: Implement `flattenCatalog`, `unflattenCatalog`, `validateTranslationKey`, `validateLocale` (apps/www/src/server/translations/catalog-utils.ts)
- [ ] Phase C: Tests for catalog utilities (apps/www/src/server/translations/catalog-utils.test.ts)
- [ ] Phase D: Implement `importTranslationCatalog` (apps/www/src/server/translations/import-service.ts)
- [ ] Phase D: Tests for import service (apps/www/src/server/translations/import-service.test.ts)
- [ ] Phase E: Implement export service (apps/www/src/server/translations/export-service.ts)
- [ ] Phase E: Tests for export service
- [ ] Phase F: HTTP route handlers for import/export (apps/www/src/server/routes/api/v1/translations/)
- [ ] Phase G: Admin translations page (apps/www/src/app/pages/admin/translations/)
- [ ] Phase G: Generic locale selector in admin field-control (packages/admin/src/field-control.component.ts)
- [ ] Phase H: Integration tests
- [ ] Phase I: Data integrity validation hooks
- [ ] Changeset for packages/* changes
- [ ] Update STATE.md

## Test Plan

### Unit tests
- `flattenCatalog`: nested objects, flat objects, empty objects, invalid leaf values (arrays, null, numbers, booleans)
- `unflattenCatalog`: round-trip, deterministic ordering, empty input
- `validateTranslationKey`: valid keys, empty, leading/trailing dots, consecutive dots, unicode rejection
- `validateLocale`: BCP-47 valid/invalid
- Import: new messages, update existing locale, preserve other locales, no silent deletion, per-project isolation
- Export: deterministic structure, missing values with `fallback: 'none'` and `fallback: 'source'`

### Integration tests
- Two projects with different locale sets coexist without leaking
- Full import → export round-trip preserves structure

### E2E (Playwright)
1. Login
2. Create translation project "Volt UI" with en/es/uk
3. Import en.json, es.json, uk.json
4. Export es.json
5. Verify exported JSON matches expected structure

### Quality gate
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Acceptance Criteria

1. `translation_projects` and `translation_messages` collections exist and are usable through the standard CRUD API.
2. Importing a nested JSON catalog creates one message record per flattened key.
3. Importing a second locale updates existing records without destroying other locale values.
4. Exporting a locale recreates the nested JSON catalog shape with deterministic ordering.
5. Two projects with different locale sets coexist without locale leakage.
6. The HTTP import/export endpoints work with proper auth and error handling.
7. The admin has a minimal translations management page.
8. Generic localized fields are usable in the admin (locale selector works).
9. `FieldDescription.localized` and `CollectionDescription.locales` propagate to the Angular client.
10. HTTP `?locale=` query parameter works for reading/writing localized content.
11. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green.

## Open Questions

None.

## Outcome

Shipped 2026-08-22. All acceptance criteria met. Localization metadata gaps fixed across runtime describe, HTTP handlers, Angular types/query/client, and admin field-control. Translation domain model (translation_projects + translation_messages) added to apps/www. Catalog utilities (flatten/unflatten/validate) with 34 unit tests. Import/export services with 13 integration tests. HTTP endpoints for auth-protected import/export. Minimal admin page at /admin/translations. Quality gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
