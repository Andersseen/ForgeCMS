/**
 * `@forge-cms/angular` — the browser-side client.
 *
 * A barrel over several modules, so `resources.ts`/`auth-session.ts`/`auth-guard.ts` can build on the
 * service and the types without an import cycle (`import/no-cycle` is an error in this repo):
 *
 * - `types.ts`        response shapes, config token, typed errors, role helpers
 * - `transport.ts`    URL joining, identifier encoding, credential policy, error decoding (spec 075)
 * - `query.ts`        `QueryOptions` → the query string the API parses
 * - `schema.ts`       schema-aware wire types (spec 076), types only
 * - `api.service.ts`  `CmsApiService`, promise-based
 * - `resources.ts`    signal-based reads over the same service
 * - `auth-session.ts` `ForgeAuthSession` — signals-based browser session state (spec 054)
 * - `auth-guard.ts`   `forgeAuthGuard` — functional Angular Router guard (spec 054)
 */
export {
  FORGE_CMS_CONFIG,
  provideForgeCms,
  ApiAuthActionError,
  ApiAuthError,
  ApiValidationError,
  ForgeApiError,
  isForgeApiError,
  USER_ROLES,
  userRole,
  isAdmin,
  canWriteContent,
  canManageUsers,
  type ApiErrorBody,
  type ApiFieldError,
  type ApiItemResponse,
  type ApiListResponse,
  type AuthUser,
  type BlockMeta,
  type CollectionMeta,
  type CreateUserInput,
  type FieldMeta,
  type ForgeApiErrorInit,
  type ForgeApiErrorKind,
  type ForgeCmsConfig,
  type ForgeRequestOptions,
  type ForgeTransport,
  type ForgeTransportRequest,
  type GlobalMeta,
  type ListMeta,
  type PaginatedDocuments,
  type UserRole
} from './types.js';

export {
  buildQueryString,
  type QueryOptions,
  type QueryWhere,
  type WhereFields,
  type WhereAndGroup,
  type WhereOrGroup,
  type WhereCondition,
  type SortField,
  type SortInput
} from './query.js';

export {
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_CONTENT_BASE_URL,
  encodePathSegment,
  fetchTransport
} from './transport.js';

export {
  type ForgeBlockRow,
  type ForgeCollectionSlug,
  type ForgeCreateInput,
  type ForgeDocument,
  type ForgeDocumentMeta,
  type ForgeDraftsCollectionSlug,
  type ForgeGlobalDocument,
  type ForgeGlobalInput,
  type ForgeGlobalSlug,
  type ForgeGlobalWriteResult,
  type ForgeLocalizedValue,
  type ForgeQueryField,
  type ForgeQueryOptions,
  type ForgeSchema,
  type ForgeSort,
  type ForgeUpdateInput,
  type ForgeUploadFields,
  type ForgeWhere,
  type ForgeWriteReceipt,
  type ForgeWriteResult,
  type UntypedDocument,
  type UntypedForgeSchema
} from './schema.js';

export {
  CmsApiService,
  injectForgeClient,
  type ForgeDocumentReadOptions,
  type ForgeWriteOptions
} from './api.service.js';

export {
  collectionResource,
  documentResource,
  type CollectionRequest,
  type DocumentRequest,
  type ForgeResource
} from './resources.js';

export { ForgeAuthSession, type ForgeAuthStatus } from './auth-session.js';
export { forgeAuthGuard, type ForgeAuthGuardOptions } from './auth-guard.js';

// Forge Analytics (spec 057) — opt-in, experimental
export { FORGE_ANALYTICS_CONFIG, type ForgeAnalyticsConfig } from './analytics-config.js';
export { provideForgeAnalytics } from './analytics.js';
export { ForgeAnalyticsTracker } from './analytics-tracker.service.js';
export {
  ForgeAnalyticsApiService,
  type AnalyticsRange,
  type AnalyticsTotals,
  type AnalyticsTimelinePoint,
  type AnalyticsSummaryResponse
} from './analytics-api.service.js';
