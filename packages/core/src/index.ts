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
  | 'upload';

export interface FieldAccess {
  /** Role names allowed to read this field's value. Undefined = every role (incl. unauthenticated). */
  read?: string[];
  /** Role names allowed to set this field on create/update. Undefined = anyone who can write the collection. */
  write?: string[];
}

export interface BaseFieldOptions {
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  unique?: boolean;
  index?: boolean;
  access?: FieldAccess;
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
  | UploadField;

export type FieldMap = Record<string, AnyField>;

export interface HookContext {
  collection: CollectionDefinition;
  operation: 'create' | 'update';
  data: Record<string, unknown>;
  /** The record as it existed before this change. Only set for `update`. */
  previousData?: Record<string, unknown>;
}

export type BeforeChangeHook = (
  ctx: HookContext
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type AfterChangeHook = (
  ctx: HookContext & { result: Record<string, unknown> }
) => void | Promise<void>;

export interface CollectionHooks {
  beforeChange?: BeforeChangeHook[];
  afterChange?: AfterChangeHook[];
}

export interface CollectionAccess {
  /** Role names allowed to read documents. Undefined = public (today's default). */
  read?: string[];
  /** Role names allowed to create documents. Undefined = fall back to the route's own role check. */
  create?: string[];
  update?: string[];
  delete?: string[];
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

export type CollectionData<TCollection extends CollectionDefinition> = {
  [Key in keyof TCollection['fields']]: TCollection['fields'][Key] extends FieldDefinition<
    FieldKind,
    infer TValue,
    BaseFieldOptions
  >
    ? TValue
    : never;
};

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
  validateCollection,
  type ValidationError,
  type ValidationErrorCode,
  type ValidationResult
} from './validation.js';
