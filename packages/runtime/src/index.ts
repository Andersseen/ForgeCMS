export type { AdapterSet, ForgeCmsConfig } from './config.js';
export type { OperationContext } from './context.js';
export { ForgeCmsRuntime } from './runtime.js';
export {
  handleList,
  handleRead,
  handleCreate,
  handleUpdate,
  handleDelete,
  handleGlobalRead,
  handleGlobalUpdate,
  handleListVersions,
  handleGetVersion,
  handleRestoreVersion,
  handlePreview,
  type HandlerOptions,
  type PreviewOptions,
  DEFAULT_LIMIT,
  MAX_LIMIT
} from './handlers.js';

// Serving stored files (spec 040)
export { handleFile, type FileHandlerOptions } from './files.js';

// Field defaults and auto-slugs (spec 040)
export { applyFieldDefaults, applyAutoSlugs } from './defaults.js';

// Local API (spec 019) — the transport-free way to run CMS operations from server code.
export {
  find,
  findByID,
  count,
  create,
  update,
  deleteDocument,
  type PaginatedDocs,
  type BaseOperationArgs,
  type FindArgs,
  type FindByIDArgs,
  type CountArgs,
  type CreateArgs,
  type UpdateArgs,
  type DeleteArgs
} from './operations.js';

// Globals — singleton documents (site-wide config: nav, footer, SEO defaults).
export {
  getGlobal,
  updateGlobal,
  type GlobalBaseArgs,
  type GetGlobalArgs,
  type UpdateGlobalArgs
} from './globals.js';

// Versions — document history, diff, restore.
export {
  listVersions,
  getVersion,
  restoreVersion,
  createVersion,
  versionsEnabled,
  autosaveEnabled,
  type ListVersionsArgs,
  type GetVersionArgs,
  type RestoreVersionArgs,
  type CreateVersionArgs
} from './versions.js';

// Localization — i18n fields, locale resolution, fallback chain.
export {
  resolveLocale,
  getLocalizedValue,
  setLocalizedValue,
  isLocalizedCollection,
  isLocalizedField,
  extractLocaleFromRequest,
  resolveLocalizedDocument,
  storeLocalizedDocument
} from './localization.js';

export {
  ForgeError,
  NotFoundError,
  InvalidInputError,
  InvalidQueryError,
  UnknownFieldError,
  ValidationFailedError,
  UnauthorizedError,
  AccessDeniedError,
  isForgeError,
  toApiErrorBody,
  type ForgeErrorCode,
  type ForgeApiErrorBody
} from './errors.js';

export { populateRecord, populateRecords } from './populate.js';

// Schema metadata for clients (the admin UI builds its form from this).
export {
  describeCollection,
  describeCollections,
  describeFields,
  describeGlobal,
  describeGlobals,
  type CollectionDescription,
  type GlobalDescription,
  type FieldDescription,
  type BlockDescription
} from './describe.js';

// Access control (spec 020)
export {
  resolveAccess,
  resolveFieldAccess,
  mergeWhere,
  documentMatches,
  type AccessDecision
} from './access.js';

// Hook pipeline (spec 021)
export {
  runBeforeOperationHooks,
  runAfterOperationHooks,
  runBeforeValidateHooks,
  runBeforeChangeHooks,
  runAfterChangeHooks,
  runBeforeReadHooks,
  runAfterReadHooks,
  runBeforeDeleteHooks,
  runAfterDeleteHooks,
  runFieldHooks
} from './hooks.js';

export { filterReadableFields, assertWritableFields, FieldAccessError } from './field-access.js';
