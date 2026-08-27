import { validateCollectionIdentifiers, validateGlobalIdentifiers } from './identifiers.js';
import { validateCollectionIndexes } from './collection-indexes.js';

export type FieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'relation'
  | 'json'
  | 'select'
  | 'slug'
  | 'email'
  | 'textarea'
  | 'richtext'
  | 'upload'
  | 'group'
  | 'array'
  | 'blocks';

/** Field kinds whose value contains other fields. Stored as a JSON column, validated recursively. */
export const COMPOSITE_FIELD_KINDS = ['group', 'array', 'blocks'] as const;

export type CompositeFieldKind = (typeof COMPOSITE_FIELD_KINDS)[number];

export function isCompositeKind(kind: FieldKind): kind is CompositeFieldKind {
  return (COMPOSITE_FIELD_KINDS as readonly string[]).includes(kind);
}

/**
 * The authenticated user as the schema layer sees it. Structurally identical to `@forge-cms/auth`'s
 * `AuthUser` — declared here rather than imported because `@forge-cms/auth` depends on this package,
 * and an import back would be a cycle.
 */
export interface CmsUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

export type MaybePromise<T> = T | Promise<T>;

/**
 * A `where`-shaped constraint returned by an access function to narrow which documents an operation
 * may touch. Structurally identical to `@forge-cms/db`'s `DatabaseWhere` (`Record<string, unknown>`)
 * — declared here to keep `@forge-cms/core` dependency-free.
 */
export type AccessQuery = Record<string, unknown>;

export type AccessOperation = 'read' | 'create' | 'update' | 'delete';

export interface AccessArgs {
  /** The user the operation runs as; `null` for anonymous requests. */
  user: CmsUser | null;
  operation: AccessOperation;
  collection: CollectionDefinition;
  /** Target document id — set for read-one, update and delete. */
  id?: string;
  /** Incoming body — set for create and update. */
  data?: Record<string, unknown>;
  /** The stored document as it is now — set for update and delete. */
  doc?: Record<string, unknown>;
}

/**
 * `true`/`false` grants or denies outright. Returning an {@link AccessQuery} grants access **only to
 * the documents matching it**: the constraint is AND-merged into reads, and checked against the
 * stored document on update/delete. This is what makes row-level rules ("authors may only edit their
 * own posts", per-tenant isolation) expressible.
 */
export type AccessResult = boolean | AccessQuery;

export type AccessFn = (args: AccessArgs) => MaybePromise<AccessResult>;

/** A list of role names (sugar for "user's role is in this list") or a full access function. */
export type AccessRule = string[] | AccessFn;

export interface FieldAccessArgs {
  user: CmsUser | null;
  operation: AccessOperation;
  collection: CollectionDefinition;
  fieldName: string;
  /** The stored document, when reading. */
  doc?: Record<string, unknown>;
  /** The incoming body, when writing. */
  data?: Record<string, unknown>;
}

export type FieldAccessFn = (args: FieldAccessArgs) => MaybePromise<boolean>;

export type FieldAccessRule = string[] | FieldAccessFn;

export interface FieldAccess {
  /** Roles (or a predicate) allowed to read this field. Undefined = everyone, incl. unauthenticated. */
  read?: FieldAccessRule;
  /** Roles (or a predicate) allowed to set this field. Undefined = anyone who can write the collection. */
  write?: FieldAccessRule;
}

export interface FieldHookArgs {
  /** The field's current value in the operation. */
  value: unknown;
  /** The full document/body the field belongs to. */
  data: Record<string, unknown>;
  /** The field's value before this change — only on update and read. */
  previousValue?: unknown;
  fieldName: string;
  collection: CollectionDefinition;
  operation: HookOperation;
  user: CmsUser | null;
  /** `true` when the operation skipped access control. See {@link BaseHookArgs.overrideAccess}. */
  overrideAccess?: boolean;
}

/** Returns the value to use in place of `args.value`. */
export type FieldHook = (args: FieldHookArgs) => MaybePromise<unknown>;

export interface FieldHooks {
  /** Runs before validation on create/update — normalise or derive here. */
  beforeValidate?: FieldHook[];
  /** Runs after validation, before the write. */
  beforeChange?: FieldHook[];
  /** Runs on every read, before the value reaches the caller. */
  afterRead?: FieldHook[];
}

export interface BaseFieldOptions {
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  unique?: boolean;
  index?: boolean;
  access?: FieldAccess;
  hooks?: FieldHooks;
  /**
   * When true, the field stores values per locale as `{ en: "Hello", es: "Hola" }`.
   * The stored value is a JSON object with locale codes as keys.
   */
  localized?: boolean;
}

export interface TextFieldOptions extends BaseFieldOptions {
  minLength?: number;
  maxLength?: number;
}

export interface NumberFieldOptions extends BaseFieldOptions {
  min?: number;
  max?: number;
}

export type BooleanFieldOptions = BaseFieldOptions;

export interface DateFieldOptions extends BaseFieldOptions {
  withTime?: boolean;
}

export interface RelationFieldOptions extends BaseFieldOptions {
  collection: string;
  many?: boolean;
  /**
   * What to do when the related document is deleted.
   * - 'restrict': Prevent deletion if any documents reference it (default)
   * - 'cascade': Delete all documents that reference it
   * - 'set-null': Set the relation field to null in referencing documents
   */
  onDelete?: 'restrict' | 'cascade' | 'set-null';
}

export interface UploadFieldOptions extends BaseFieldOptions {
  /** The upload-enabled collection this field references. */
  collection: string;
}

export type JsonFieldOptions = BaseFieldOptions;

export interface SelectFieldOptions extends BaseFieldOptions {
  options: string[];
}

export interface SlugFieldOptions extends TextFieldOptions {
  autoGenerate?: boolean;
  sourceField?: string;
}

export type EmailFieldOptions = TextFieldOptions;

export type TextareaFieldOptions = TextFieldOptions;

export interface RichTextNode {
  type: string;
  /** Leaf/text nodes. */
  text?: string;
  /** Block/element nodes. */
  children?: RichTextNode[];
  /** Marks (bold, italic, ...) and node-specific data (level, href, ...) — intentionally open. */
  [extra: string]: unknown;
}

/** A rich text document: an array of top-level block nodes. */
export type RichTextContent = RichTextNode[];

export type RichTextFieldOptions = BaseFieldOptions;

/** A fixed set of nested fields, stored as one JSON object. */
export interface GroupFieldOptions extends BaseFieldOptions {
  fields: FieldMap;
}

/** A repeatable list of rows, every row sharing the same nested fields. */
export interface ArrayFieldOptions extends BaseFieldOptions {
  fields: FieldMap;
  minRows?: number;
  maxRows?: number;
}

/** One named shape a `blocks` field may contain. */
export interface BlockDefinition<
  TSlug extends string = string,
  TFields extends FieldMap = FieldMap
> {
  slug: TSlug;
  label?: string;
  fields: Readonly<TFields>;
}

/**
 * A repeatable list where each row picks one of several shapes, discriminated by `blockType`.
 * This is the page-builder primitive.
 */
export interface BlocksFieldOptions extends BaseFieldOptions {
  blocks: BlockDefinition[];
  minRows?: number;
  maxRows?: number;
}

/** A single row of a `blocks` field: the chosen block's slug plus that block's field values. */
export type BlockValue = Record<string, unknown> & { blockType: string };

export function defineBlock<TSlug extends string, TFields extends FieldMap>(
  block: BlockDefinition<TSlug, TFields>
): BlockDefinition<TSlug, TFields> {
  return block;
}

export interface FieldDefinition<
  TKind extends FieldKind = FieldKind,
  TValue = unknown,
  TOptions extends BaseFieldOptions = BaseFieldOptions
> {
  kind: TKind;
  options: Readonly<TOptions>;
  __value?: TValue;
}

export type TextField = FieldDefinition<'text', string, TextFieldOptions>;
export type NumberField = FieldDefinition<'number', number, NumberFieldOptions>;
export type BooleanField = FieldDefinition<'boolean', boolean, BooleanFieldOptions>;
export type DateField = FieldDefinition<'date', Date, DateFieldOptions>;
export type RelationField = FieldDefinition<'relation', string | string[], RelationFieldOptions>;
export type JsonField = FieldDefinition<'json', unknown, JsonFieldOptions>;
export type SelectField = FieldDefinition<'select', string, SelectFieldOptions>;
export type SlugField = FieldDefinition<'slug', string, SlugFieldOptions>;
export type EmailField = FieldDefinition<'email', string, EmailFieldOptions>;
export type TextareaField = FieldDefinition<'textarea', string, TextareaFieldOptions>;
export type RichTextField = FieldDefinition<'richtext', RichTextContent, RichTextFieldOptions>;
export type UploadField = FieldDefinition<'upload', string, UploadFieldOptions>;
export type GroupField = FieldDefinition<'group', Record<string, unknown>, GroupFieldOptions>;
export type ArrayField = FieldDefinition<'array', Record<string, unknown>[], ArrayFieldOptions>;
export type BlocksField = FieldDefinition<'blocks', BlockValue[], BlocksFieldOptions>;

export type AnyField =
  | TextField
  | NumberField
  | BooleanField
  | DateField
  | RelationField
  | JsonField
  | SelectField
  | SlugField
  | EmailField
  | TextareaField
  | RichTextField
  | UploadField
  | GroupField
  | ArrayField
  | BlocksField;

export type FieldMap = Record<string, AnyField>;

/** The runtime value a single field definition carries. */
export type FieldValue<TField> =
  TField extends FieldDefinition<FieldKind, infer TValue, BaseFieldOptions> ? TValue : never;

/** The runtime shape of a whole `FieldMap` — used for collections and for nested composite fields. */
export type InferFields<TFields extends FieldMap> = {
  [Key in keyof TFields]: FieldValue<TFields[Key]>;
};

export type HookOperation = 'create' | 'update' | 'read' | 'delete';

export interface BaseHookArgs {
  collection: CollectionDefinition;
  operation: HookOperation;
  /** The user the operation runs as; `null` for anonymous or for direct Local API calls. */
  user?: CmsUser | null;
  /**
   * `true` when the operation skipped access control — i.e. trusted server-side code (a seed
   * script, a scheduled job, a Local API call) rather than a request off the network.
   *
   * Without this a hook cannot tell the two apart, because both arrive with `user: null`. A hook
   * that hardens public writes ("force `status` to `pending`") must check it, or it will also
   * rewrite what your own server code deliberately wrote.
   */
  overrideAccess?: boolean;
}

/**
 * Args for the write pipeline. `result` is a legacy alias of `doc`, kept so `afterChange` hooks
 * written against spec 013 keep working unchanged.
 */
export interface HookContext extends BaseHookArgs {
  operation: 'create' | 'update';
  data: Record<string, unknown>;
  /** The record as it existed before this change. Only set for `update`. */
  previousData?: Record<string, unknown>;
}

export type BeforeValidateHook = (ctx: HookContext) => MaybePromise<Record<string, unknown>>;

export type BeforeChangeHook = (ctx: HookContext) => MaybePromise<Record<string, unknown>>;

export type AfterChangeHook = (
  ctx: HookContext & { doc: Record<string, unknown>; result: Record<string, unknown> }
) => MaybePromise<void>;

export interface ReadHookArgs extends BaseHookArgs {
  operation: 'read';
  doc: Record<string, unknown>;
}

/** Runs once per operation, before the query is issued. May narrow the query it is handed. */
export type BeforeReadHook = (
  ctx: BaseHookArgs & { operation: 'read'; query: AccessQuery }
) => MaybePromise<AccessQuery>;

/** Runs per document. Returns the document to hand back to the caller. */
export type AfterReadHook = (ctx: ReadHookArgs) => MaybePromise<Record<string, unknown>>;

export interface DeleteHookArgs extends BaseHookArgs {
  operation: 'delete';
  id: string;
  doc: Record<string, unknown>;
}

export type BeforeDeleteHook = (ctx: DeleteHookArgs) => MaybePromise<void>;

export type AfterDeleteHook = (ctx: DeleteHookArgs) => MaybePromise<void>;

/** Runs first on every operation, before access control resolves. Side effects only. */
export type BeforeOperationHook = (ctx: BaseHookArgs) => MaybePromise<void>;

/** Runs last on every operation, with whatever the operation is about to return. */
export type AfterOperationHook = (ctx: BaseHookArgs & { result: unknown }) => MaybePromise<void>;

export interface CollectionHooks {
  beforeOperation?: BeforeOperationHook[];
  beforeValidate?: BeforeValidateHook[];
  beforeChange?: BeforeChangeHook[];
  afterChange?: AfterChangeHook[];
  beforeRead?: BeforeReadHook[];
  afterRead?: AfterReadHook[];
  beforeDelete?: BeforeDeleteHook[];
  afterDelete?: AfterDeleteHook[];
  afterOperation?: AfterOperationHook[];
}

export interface CollectionAccess {
  /** Who may read. Undefined = public (today's default). A returned query filters the result set. */
  read?: AccessRule;
  /** Who may create. Undefined = fall back to the route's own role check. */
  create?: AccessRule;
  update?: AccessRule;
  delete?: AccessRule;
}

export interface CollectionDefinition<
  TSlug extends string = string,
  TFields extends FieldMap = FieldMap
> {
  slug: TSlug;
  fields: Readonly<TFields>;
  hooks?: CollectionHooks;
  access?: CollectionAccess;
  /** Marks this collection as upload-enabled: `POST` accepts a `multipart/form-data` body (spec 016). */
  upload?: boolean;
  /** Adds a system `_status: 'draft' | 'published'` field; unpublished docs are hidden from public reads (spec 017). */
  drafts?: boolean;
  /**
   * Enables version history for this collection. Every update creates a snapshot that can be
   * listed, compared, and restored. Autosave creates frequent drafts without publishing.
   */
  versions?: boolean | { autosave?: boolean };
  /**
   * Supported locales for this collection. When set, fields marked with `localized: true`
   * store values per locale. First locale is the default/fallback.
   * Example: `['en', 'es', 'fr']`
   */
  locales?: string[];
  /**
   * Collection-level indexes, for constraints that span more than one field. Field order matters —
   * it is the column order of the generated SQL index. Single-field `unique`/`index` on
   * {@link BaseFieldOptions} keep working unchanged; this is additive sugar for the multi-field case.
   */
  indexes?: CollectionIndex[];
}

/** One collection-level index. See {@link CollectionDefinition.indexes}. */
export interface CollectionIndex {
  /** Field order matters: it is the column order in the generated SQL index. */
  fields: string[];
  unique?: boolean;
}

/**
 * A singleton document — a single record rather than a collection of many.
 *
 * Globals are the right shape for site-wide configuration: navigation, footer, SEO defaults,
 * theme settings. They share the same field DSL as collections but have exactly one document,
 * addressed by slug rather than by id.
 */
export interface GlobalDefinition<
  TSlug extends string = string,
  TFields extends FieldMap = FieldMap
> {
  slug: TSlug;
  fields: Readonly<TFields>;
  hooks?: CollectionHooks;
  access?: CollectionAccess;
  /** Adds a system `_status: 'draft' | 'published'` field; unpublished globals are hidden from public reads. */
  drafts?: boolean;
}

export type GlobalData<TGlobal extends GlobalDefinition> = InferFields<TGlobal['fields']>;

/**
 * A point-in-time snapshot of a document. Versions are created automatically on every update when
 * `versions: true` is set on the collection, or manually via the autosave mechanism.
 */
export interface Version {
  id: string;
  /** The id of the document this version belongs to. */
  documentId: string;
  /** Monotonically increasing version number within the document. */
  versionNumber: number;
  /** The full document data at this version. */
  data: Record<string, unknown>;
  /** When this version was created. */
  createdAt: string;
  /** The user who created this version (null for system/autosave). */
  createdBy: string | null;
  /** Whether this is an autosave (frequent, non-publishing) version. */
  autosave: boolean;
  /** Optional human-readable label (e.g. "Fixed typo", "Initial draft"). */
  label?: string;
}

export type DraftStatus = 'draft' | 'published';

export type CollectionData<TCollection extends CollectionDefinition> = InferFields<
  TCollection['fields']
>;

/**
 * An ordered/unordered set of registered collections, as `ForgeCmsConfig.collections` carries it.
 * Mutable (not `readonly`) to match `DatabaseAdapter.syncSchema`'s existing parameter type — the
 * union-of-specific-collection-types inference `CollectionSlug`/`CollectionBySlug` rely on works the
 * same either way, since both index with `[number]` rather than relying on tuple positions.
 */
export type CollectionRegistry = CollectionDefinition[];

/** The union of registered collection slugs. `string` when the registry itself is untyped/broad. */
export type CollectionSlug<TCollections extends CollectionRegistry> = TCollections[number]['slug'];

/**
 * Registered collections keyed by slug. For a broad/untyped registry (`TCollections[number]`'s slug is
 * plain `string`, not a union of literals), key-remapping over a non-literal key produces an
 * **index-signature** type (`{ [x: string]: CollectionDefinition<string, FieldMap> }`) rather than a
 * `never`-prone `Extract`. That is what lets {@link CollectionBySlug} fall back gracefully instead of
 * resolving to `never` for a broad registry — and, unlike an `Extract<...> extends never ? ... : ...`
 * conditional, a plain indexed-access lookup on this mapped type does not turn into a deferred
 * conditional type, which matters: TypeScript structurally compares two *different* concrete
 * `ForgeCmsRuntime<Env, TCollections>` instantiations (e.g. assigning a narrowly-typed runtime to a
 * variable declared with the class's own broad default) whenever one is used where the other is
 * expected, and a deferred conditional type in a method's return position broke exactly that
 * comparison during implementation (see spec 047).
 */
type CollectionMap<TCollections extends CollectionRegistry> = {
  [TCollection in TCollections[number] as TCollection['slug']]: TCollection;
};

/** The specific collection definition for one slug. */
export type CollectionBySlug<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = CollectionMap<TCollections>[TSlug] extends infer TCollection extends CollectionDefinition
  ? TCollection
  : never;

/** Standard document metadata every stored record carries, alongside its declared fields. */
export interface DocumentMeta {
  id: string;
  created_at: string;
  updated_at: string;
}

/** The full typed shape of a stored document: declared fields plus standard metadata. */
export type CollectionDocument<TCollection extends CollectionDefinition> =
  CollectionData<TCollection> & DocumentMeta;

/** A typed create/update payload: any subset of the collection's declared fields. */
export type CollectionInput<TCollection extends CollectionDefinition> = Partial<
  CollectionData<TCollection>
>;

function createField<
  TKind extends FieldKind,
  TValue,
  TOptions extends BaseFieldOptions = BaseFieldOptions
>(kind: TKind, options: TOptions = {} as TOptions): FieldDefinition<TKind, TValue, TOptions> {
  return {
    kind,
    options
  };
}

export const defineField = {
  text(options: TextFieldOptions = {}): TextField {
    return createField<'text', string, TextFieldOptions>('text', options);
  },
  number(options: NumberFieldOptions = {}): NumberField {
    return createField<'number', number, NumberFieldOptions>('number', options);
  },
  boolean(options: BooleanFieldOptions = {}): BooleanField {
    return createField<'boolean', boolean, BooleanFieldOptions>('boolean', options);
  },
  date(options: DateFieldOptions = {}): DateField {
    return createField<'date', Date, DateFieldOptions>('date', options);
  },
  relation(options: RelationFieldOptions): RelationField {
    return createField<'relation', string | string[], RelationFieldOptions>('relation', options);
  },
  /**
   * `defineField.json()` infers `unknown`, same as before. A consumer-provided generic
   * (`defineField.json<CatalogContent>()`) is a **compile-time annotation only** — it carries a type
   * through `InferFields`/`CollectionData` for DX, but does not add runtime shape validation. Callers
   * remain responsible for validating untrusted JSON at runtime.
   */
  json<TValue = unknown>(
    options: JsonFieldOptions = {}
  ): FieldDefinition<'json', TValue, JsonFieldOptions> {
    return createField<'json', TValue, JsonFieldOptions>('json', options);
  },
  select(options: SelectFieldOptions): SelectField {
    return createField<'select', string, SelectFieldOptions>('select', options);
  },
  slug(options: SlugFieldOptions = {}): SlugField {
    return createField<'slug', string, SlugFieldOptions>('slug', options);
  },
  email(options: EmailFieldOptions = {}): EmailField {
    return createField<'email', string, EmailFieldOptions>('email', options);
  },
  textarea(options: TextareaFieldOptions = {}): TextareaField {
    return createField<'textarea', string, TextareaFieldOptions>('textarea', options);
  },
  richtext(options: RichTextFieldOptions = {}): RichTextField {
    return createField<'richtext', RichTextContent, RichTextFieldOptions>('richtext', options);
  },
  upload(options: UploadFieldOptions): UploadField {
    return createField<'upload', string, UploadFieldOptions>('upload', options);
  },
  /**
   * A fixed set of nested fields. The generic keeps full type inference through the nesting:
   * `defineField.group({ fields: { city: defineField.text() } })` infers `{ city: string }`.
   */
  group<TFields extends FieldMap>(
    options: GroupFieldOptions & { fields: TFields }
  ): FieldDefinition<'group', InferFields<TFields>, GroupFieldOptions> {
    return createField<'group', InferFields<TFields>, GroupFieldOptions>('group', options);
  },
  /** A repeatable list of rows sharing one shape; infers `Row[]`. */
  array<TFields extends FieldMap>(
    options: ArrayFieldOptions & { fields: TFields }
  ): FieldDefinition<'array', InferFields<TFields>[], ArrayFieldOptions> {
    return createField<'array', InferFields<TFields>[], ArrayFieldOptions>('array', options);
  },
  /**
   * A repeatable list where each row picks one of `blocks`, discriminated by `blockType`. Rows stay
   * typed as {@link BlockValue} rather than a discriminated union — narrowing on `blockType` is a
   * consumer-side concern, and a precise union here makes the recursive field types unresolvable.
   */
  blocks(options: BlocksFieldOptions): BlocksField {
    return createField<'blocks', BlockValue[], BlocksFieldOptions>('blocks', options);
  }
} as const;

export function defineCollection<TSlug extends string, TFields extends FieldMap>(
  config: CollectionDefinition<TSlug, TFields>
): CollectionDefinition<TSlug, TFields> {
  const errors = [...validateCollectionIdentifiers(config), ...validateCollectionIndexes(config)];
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  return config;
}

export function defineGlobal<TSlug extends string, TFields extends FieldMap>(
  config: GlobalDefinition<TSlug, TFields>
): GlobalDefinition<TSlug, TFields> {
  const errors = validateGlobalIdentifiers(config);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  return config;
}

/**
 * Turns human text into a URL slug: `"Láser & Piel"` → `"laser-piel"`.
 *
 * Lives here rather than in `@forge-cms/runtime` because it is the DSL that promises the behaviour
 * (`defineField.slug({ autoGenerate: true })`), and because apps that build slugs client-side must
 * produce exactly the same string the server would.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Runtime validation
export {
  validateField,
  validateFieldMap,
  validateCollection,
  type ValidationError,
  type ValidationErrorCode,
  type ValidationResult
} from './validation.js';

// Identifier validation
export {
  isValidIdentifier,
  assertValidIdentifier,
  isSystemField,
  getSystemFields,
  validateCollectionIdentifiers,
  validateGlobalIdentifiers,
  IDENTIFIER_PATTERN
} from './identifiers.js';

// Collection index validation
export { validateCollectionIndexes } from './collection-indexes.js';

// Structured logging
export {
  type ForgeLogger,
  getLogger,
  setLogger,
  createSilentLogger,
  consoleLogger
} from './logger.js';
