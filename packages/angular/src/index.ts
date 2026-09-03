/**
 * `@forge-cms/angular` — the browser-side client.
 *
 * A barrel over several modules, so `resources.ts`/`auth-session.ts`/`auth-guard.ts` can build on the
 * service and the types without an import cycle (`import/no-cycle` is an error in this repo):
 *
 * - `types.ts`        response shapes, config token, typed errors, role helpers
 * - `query.ts`        `QueryOptions` → the query string the API parses
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
  type ForgeCmsConfig,
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

export { CmsApiService } from './api.service.js';

export {
  collectionResource,
  documentResource,
  type CollectionRequest,
  type DocumentRequest,
  type ForgeResource
} from './resources.js';

export { ForgeAuthSession, type ForgeAuthStatus } from './auth-session.js';
export { forgeAuthGuard, type ForgeAuthGuardOptions } from './auth-guard.js';
