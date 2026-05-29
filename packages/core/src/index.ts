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
  | 'textarea';

export interface BaseFieldOptions {
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  unique?: boolean;
  index?: boolean;
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
  | TextareaField;

export type FieldMap = Record<string, AnyField>;

export interface CollectionDefinition<
  TSlug extends string = string,
  TFields extends FieldMap = FieldMap
> {
  slug: TSlug;
  fields: Readonly<TFields>;
}

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
