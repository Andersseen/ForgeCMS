export type { AdapterSet, ForgeCmsConfig } from './config.js';
export type { OperationContext } from './context.js';
export { ForgeCmsRuntime } from './runtime.js';
export {
  handleList,
  handleRead,
  handleCreate,
  handleUpdate,
  handleDelete,
  type HandlerOptions
} from './handlers.js';

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

export {
  ForgeError,
  NotFoundError,
  InvalidInputError,
  ValidationFailedError,
  UnauthorizedError,
  AccessDeniedError,
  isForgeError
} from './errors.js';

export { populateRecord, populateRecords } from './populate.js';

// Schema metadata for clients (the admin UI builds its form from this).
export {
  describeCollection,
  describeCollections,
  describeFields,
  type CollectionDescription,
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
