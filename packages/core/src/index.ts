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
}

export type DraftStatus = 'draft' | 'published';

export type CollectionData<TCollection extends CollectionDefinition> = InferFields<
  TCollection['fields']
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
  json(options: JsonFieldOptions = {}): JsonField {
    return createField<'json', unknown, JsonFieldOptions>('json', options);
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
  return config;
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
