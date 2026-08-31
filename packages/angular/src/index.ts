/**
 * `@forge-cms/angular` — the browser-side client.
 *
 * A barrel over four modules, so `resources.ts` can build on both the service and the types without
 * an import cycle (`import/no-cycle` is an error in this repo):
 *
 * - `types.ts`       response shapes, config token, typed errors, role helpers
 * - `query.ts`       `QueryOptions` → the query string the API parses
 * - `api.service.ts` `CmsApiService`, promise-based
 * - `resources.ts`   signal-based reads over the same service
 */
export {
  FORGE_CMS_CONFIG,
  provideForgeCms,
  ApiAuthError,
  ApiValidationError,
  USER_ROLES,
  userRole,
  isAdmin,
  canWriteContent,
  canManageUsers,
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
