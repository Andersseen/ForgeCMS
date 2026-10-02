/**
 * Schema-aware wire types (spec 076, roadmap 0.8 C02) — types only, no runtime code.
 *
 * A consumer shares the *type* of its content model with the browser (`import type`, erased from the
 * emitted JavaScript) and gets compile-time knowledge of what the HTTP API accepts and returns. These
 * projections describe the JSON the server actually sends, which is not the server-side schema value:
 *
 * - **read** (`ForgeDocument`): dates are ISO strings; a field with an `access.read` rule may be omitted;
 *   an optional field may be absent (in-memory) or `null` (SQL); `depth: 1` replaces a relation/upload id
 *   with the readable target or `null` (single) / the readable targets (many); localized fields are a
 *   per-locale map unless a `locale` was requested;
 * - **create** (`ForgeCreateInput`): what the caller must provide — Forge generates ids, timestamps,
 *   defaults and auto-slugs itself;
 * - **update** (`ForgeUpdateInput`): any subset;
 * - **write result** (`ForgeWriteResult`): the read projection, or only `{ id }` when the writer may not
 *   read the result (spec 068).
 *
 * Field options are read from the literal types `defineField.*` captures since spec 076. Options that are
 * not literal (built from a variable typed with the broad options interface) are treated conservatively:
 * not required, possibly hidden, possibly `many`.
 */
import type {
  CollectionDefinition,
  DraftStatus,
  FieldValue,
  GlobalDefinition,
  RichTextContent
} from '@forge-cms/core';
import type { QueryOptions, QueryWhere, WhereCondition } from './query.js';

// --- the schema --------------------------------------------------------------------------------

/**
 * A content model as the browser sees it: the **types** of the registered collections and globals.
 *
 * ```ts
 * import type { ForgeSchema } from '@forge-cms/angular';
 * import type { collections, siteSettings } from '../server/content'; // erased: no server code bundled
 * export type SiteSchema = ForgeSchema<typeof collections, [typeof siteSettings]>;
 * ```
 *
 * Every collection/global needs a literal slug: one `string` slug makes every slug valid.
 */
export interface ForgeSchema<
  TCollections extends readonly CollectionDefinition[] = readonly CollectionDefinition[],
  TGlobals extends readonly GlobalDefinition[] = readonly GlobalDefinition[]
> {
  readonly collections: TCollections;
  readonly globals: TGlobals;
}

/** The dynamic schema: any slug and field, every result an {@link UntypedDocument}. */
export type UntypedForgeSchema = ForgeSchema;

export type ForgeCollectionSlug<S extends ForgeSchema> = S['collections'][number]['slug'];
export type ForgeGlobalSlug<S extends ForgeSchema> = S['globals'][number]['slug'];

/** Slugs of the schema's `drafts: true` collections (declared with a literal `true`). */
export type ForgeDraftsCollectionSlug<S extends ForgeSchema> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? string
    : Extract<S['collections'][number], { drafts: true }>['slug'];

/** What an untyped read or write resolves to. Only `id` is promised. */
export interface UntypedDocument {
  id: string;
  [field: string]: unknown;
}

/** A localized field read without `locale`: one value per locale code (`{ en: 'Hi', es: 'Hola' }`). */
export type ForgeLocalizedValue = Record<string, string>;

/**
 * What a create/update/global write returns when the writer may not read the result (spec 068). Narrow
 * a {@link ForgeWriteResult} with `'created_at' in result`.
 */
export interface ForgeWriteReceipt {
  id: string;
}

/** A row of a `blocks` field. Not narrowed per block: switch on `blockType`. */
export interface ForgeBlockRow {
  blockType: string;
  [field: string]: unknown;
}

/** System fields every collection document carries on the wire. */
export interface ForgeDocumentMeta {
  id: string;
  created_at: string;
  updated_at: string;
}

// --- internals ---------------------------------------------------------------------------------

type IsWide<TSlug> = string extends TSlug ? true : false;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type CollectionOf<S extends ForgeSchema, TSlug> = Extract<
  S['collections'][number],
  { slug: TSlug }
>;
type GlobalOf<S extends ForgeSchema, TSlug> = Extract<S['globals'][number], { slug: TSlug }>;

type OptionsOf<F> = F extends { options: infer O } ? O : never;
type IsRequired<F> = OptionsOf<F> extends { required: true } ? true : false;
type IsLocalized<F> = OptionsOf<F> extends { localized: true } ? true : false;

type AccessRule<O, TOperation extends 'read' | 'write'> = 'access' extends keyof O
  ? TOperation extends keyof NonNullable<O['access' & keyof O]>
    ? NonNullable<O['access' & keyof O]>[TOperation]
    : undefined
  : undefined;
/** `never`: `access.<op>: []` (nobody). `maybe`: any other rule. `always`: no rule. */
type Allowed<F, TOperation extends 'read' | 'write'> = [
  AccessRule<OptionsOf<F>, TOperation>
] extends [undefined]
  ? 'always'
  : [AccessRule<OptionsOf<F>, TOperation>] extends [readonly []]
    ? 'never'
    : 'maybe';

type HasDefault<F> = 'defaultValue' extends keyof OptionsOf<F>
  ? [OptionsOf<F>['defaultValue' & keyof OptionsOf<F>]] extends [undefined]
    ? false
    : true
  : false;
type IsAutoSlug<F> = OptionsOf<F> extends { autoGenerate: true } ? true : false;
/** A create must name the field: required, with no default and no auto-generated slug. */
type CreateRequired<F> =
  IsRequired<F> extends true
    ? HasDefault<F> extends true
      ? false
      : IsAutoSlug<F> extends true
        ? false
        : true
    : false;

/** `many: true` → many; absent or `false` → one; a non-literal `boolean` → unknown. */
type Manyness<F> = 'many' extends keyof OptionsOf<F>
  ? [OptionsOf<F>['many' & keyof OptionsOf<F>]] extends [true]
    ? 'many'
    : [OptionsOf<F>['many' & keyof OptionsOf<F>]] extends [false | undefined]
      ? 'one'
      : 'unknown'
  : 'one';
type TargetSlug<F> = OptionsOf<F> extends { collection: infer T extends string } ? T : string;
type SelectValue<F> =
  OptionsOf<F> extends { options: readonly (infer V extends string)[] } ? V : string;
type NestedFields<F> = OptionsOf<F> extends { fields: infer N } ? N : never;

type LocaleMode<L> = [L] extends [undefined] ? 'map' : undefined extends L ? 'either' : 'resolved';
type Localized<L> =
  LocaleMode<L> extends 'resolved'
    ? string
    : LocaleMode<L> extends 'map'
      ? ForgeLocalizedValue
      : string | ForgeLocalizedValue;

/** A populated target: its depth-0 read projection, without locale (targets keep per-locale maps). */
type Target<S extends ForgeSchema, TTarget extends string> =
  IsWide<TTarget> extends true
    ? UntypedDocument
    : [CollectionOf<S, TTarget>] extends [never]
      ? UntypedDocument
      : ForgeDocument<S, TTarget & ForgeCollectionSlug<S>, 0, undefined>;

type ReadValue<S extends ForgeSchema, F, D, L> = F extends { kind: 'text' | 'textarea' }
  ? IsLocalized<F> extends true
    ? Localized<L>
    : string
  : F extends { kind: 'email' | 'slug' }
    ? string
    : F extends { kind: 'number' }
      ? number
      : F extends { kind: 'boolean' }
        ? boolean
        : F extends { kind: 'date' }
          ? string
          : F extends { kind: 'select' }
            ? SelectValue<F>
            : F extends { kind: 'json' }
              ? FieldValue<F>
              : F extends { kind: 'richtext' }
                ? RichTextContent
                : F extends { kind: 'relation' }
                  ? RelationRead<S, F, D>
                  : F extends { kind: 'upload' }
                    ? [D] extends [1]
                      ? Target<S, TargetSlug<F>> | null
                      : string
                    : F extends { kind: 'group' }
                      ? NestedRead<S, NestedFields<F>>
                      : F extends { kind: 'array' }
                        ? NestedRead<S, NestedFields<F>>[]
                        : F extends { kind: 'blocks' }
                          ? ForgeBlockRow[]
                          : unknown;

type RelationRead<S extends ForgeSchema, F, D> = [D] extends [1]
  ? Manyness<F> extends 'many'
    ? Target<S, TargetSlug<F>>[]
    : Manyness<F> extends 'one'
      ? Target<S, TargetSlug<F>> | null
      : Target<S, TargetSlug<F>>[] | Target<S, TargetSlug<F>> | null
  : Manyness<F> extends 'many'
    ? string[]
    : Manyness<F> extends 'one'
      ? string
      : string | string[];

/** Nested `group`/`array` fields: required → present; otherwise optional and nullable (no access). */
type NestedRead<S extends ForgeSchema, N> = [N] extends [never]
  ? Record<string, unknown>
  : Simplify<
      {
        -readonly [K in keyof N as IsRequired<N[K]> extends true ? K : never]: ReadValue<
          S,
          N[K],
          0,
          undefined
        >;
      } & {
        -readonly [K in keyof N as IsRequired<N[K]> extends true ? never : K]?: ReadValue<
          S,
          N[K],
          0,
          undefined
        > | null;
      }
    >;

type ReadFields<S extends ForgeSchema, TFields, D, L> = {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'read'> extends 'always'
    ? IsRequired<TFields[K]> extends true
      ? K
      : never
    : never]: ReadValue<S, TFields[K], D, L>;
} & {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'read'> extends 'maybe'
    ? IsRequired<TFields[K]> extends true
      ? K
      : never
    : never]?: ReadValue<S, TFields[K], D, L>;
} & {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'read'> extends 'never'
    ? never
    : IsRequired<TFields[K]> extends true
      ? never
      : K]?: ReadValue<S, TFields[K], D, L> | null;
};

type DraftMeta<TOwner> = TOwner extends { drafts: true } ? { _status: DraftStatus } : unknown;
type DraftInput<TOwner> = TOwner extends { drafts: true } ? { _status?: DraftStatus } : unknown;

type InputValue<F, L> = F extends { kind: 'text' | 'textarea' }
  ? IsLocalized<F> extends true
    ? Localized<L>
    : string
  : F extends { kind: 'email' | 'slug' }
    ? string
    : F extends { kind: 'number' }
      ? number
      : F extends { kind: 'boolean' }
        ? boolean
        : F extends { kind: 'date' }
          ? Date | string
          : F extends { kind: 'select' }
            ? SelectValue<F>
            : F extends { kind: 'json' }
              ? FieldValue<F>
              : F extends { kind: 'richtext' }
                ? RichTextContent
                : F extends { kind: 'relation' }
                  ? Manyness<F> extends 'many'
                    ? string[]
                    : Manyness<F> extends 'one'
                      ? string
                      : string | string[]
                  : F extends { kind: 'upload' }
                    ? string
                    : F extends { kind: 'group' }
                      ? NestedInput<NestedFields<F>>
                      : F extends { kind: 'array' }
                        ? NestedInput<NestedFields<F>>[]
                        : F extends { kind: 'blocks' }
                          ? ForgeBlockRow[]
                          : unknown;

/** A nested value is written whole: nested `required` applies (nested defaults are not applied). */
type NestedInput<N> = [N] extends [never]
  ? Record<string, unknown>
  : Simplify<
      {
        -readonly [K in keyof N as IsRequired<N[K]> extends true ? K : never]: InputValue<
          N[K],
          undefined
        >;
      } & {
        -readonly [K in keyof N as IsRequired<N[K]> extends true ? never : K]?: InputValue<
          N[K],
          undefined
        > | null;
      }
    >;

type Nullable<F> = IsRequired<F> extends true ? never : null;

type CreateFields<TFields, L> = {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'write'> extends 'never'
    ? never
    : CreateRequired<TFields[K]> extends true
      ? K
      : never]: InputValue<TFields[K], L>;
} & {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'write'> extends 'never'
    ? never
    : CreateRequired<TFields[K]> extends true
      ? never
      : K]?: InputValue<TFields[K], L> | Nullable<TFields[K]>;
};

type UpdateFields<TFields, L> = {
  -readonly [K in keyof TFields as Allowed<TFields[K], 'write'> extends 'never' ? never : K]?:
    | InputValue<TFields[K], L>
    | Nullable<TFields[K]>;
};

type QueryField<C> = C extends { fields: infer TFields }
  ?
      | Extract<keyof TFields, string>
      | keyof ForgeDocumentMeta
      | (C extends { drafts: true } ? '_status' : never)
  : never;

type TypedWhere<K extends string> =
  | { [P in K]?: WhereCondition }
  | { and: TypedWhere<K>[] }
  | { or: TypedWhere<K>[] };

// --- public projections ------------------------------------------------------------------------

/**
 * One collection document as the HTTP API returns it, at `depth` `D` and for a requested `locale` `L`.
 * A slug union gives the union of documents.
 */
export type ForgeDocument<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0,
  L extends string | undefined = undefined
> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? UntypedDocument
    : TSlug extends unknown
      ? CollectionOf<S, TSlug> extends infer C
        ? C extends { fields: infer TFields }
          ? Simplify<ForgeDocumentMeta & DraftMeta<C> & ReadFields<S, TFields, D, L>>
          : never
        : never
      : never;

/** A create body: required fields without a default must be present; Forge generates the rest. */
export type ForgeCreateInput<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  L extends string | undefined = undefined
> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? Record<string, unknown>
    : TSlug extends unknown
      ? CollectionOf<S, TSlug> extends infer C
        ? C extends { fields: infer TFields }
          ? Simplify<DraftInput<C> & CreateFields<TFields, L>>
          : never
        : never
      : never;

/** An update body: any subset of the writable fields; `null` only clears non-required fields. */
export type ForgeUpdateInput<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  L extends string | undefined = undefined
> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? Record<string, unknown>
    : TSlug extends unknown
      ? CollectionOf<S, TSlug> extends infer C
        ? C extends { fields: infer TFields }
          ? Simplify<DraftInput<C> & UpdateFields<TFields, L>>
          : never
        : never
      : never;

/** What a create/update returns: the document, or a receipt when the writer may not read it. */
export type ForgeWriteResult<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  L extends string | undefined = undefined
> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? UntypedDocument
    : ForgeDocument<S, TSlug, 0, L> | ForgeWriteReceipt;

/** A global document as `getGlobal` returns it (depth 0, no locale: localized fields are maps). */
export type ForgeGlobalDocument<
  S extends ForgeSchema,
  TSlug extends ForgeGlobalSlug<S> = ForgeGlobalSlug<S>
> =
  IsWide<ForgeGlobalSlug<S>> extends true
    ? UntypedDocument
    : TSlug extends unknown
      ? GlobalOf<S, TSlug> extends infer G
        ? G extends { fields: infer TFields }
          ? Simplify<ForgeDocumentMeta & DraftMeta<G> & ReadFields<S, TFields, 0, undefined>>
          : never
        : never
      : never;

/** A global write body (partial, like an update; no locale). */
export type ForgeGlobalInput<
  S extends ForgeSchema,
  TSlug extends ForgeGlobalSlug<S> = ForgeGlobalSlug<S>
> =
  IsWide<ForgeGlobalSlug<S>> extends true
    ? Record<string, unknown>
    : TSlug extends unknown
      ? GlobalOf<S, TSlug> extends infer G
        ? G extends { fields: infer TFields }
          ? Simplify<DraftInput<G> & UpdateFields<TFields, undefined>>
          : never
        : never
      : never;

/** What `updateGlobal` returns: the global, or a receipt when the writer may not read it. */
export type ForgeGlobalWriteResult<
  S extends ForgeSchema,
  TSlug extends ForgeGlobalSlug<S> = ForgeGlobalSlug<S>
> =
  IsWide<ForgeGlobalSlug<S>> extends true
    ? UntypedDocument
    : ForgeGlobalDocument<S, TSlug> | ForgeWriteReceipt;

/** The field names a `where`/`sort` may use: declared fields plus the system fields. */
export type ForgeQueryField<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>
> = IsWide<ForgeCollectionSlug<S>> extends true ? string : QueryField<CollectionOf<S, TSlug>>;

/** A `where` clause over known field names (values stay loose; the server validates them). */
export type ForgeWhere<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>
> =
  IsWide<ForgeCollectionSlug<S>> extends true ? QueryWhere : TypedWhere<ForgeQueryField<S, TSlug>>;

/** A sort over known field names: one name, or a multi-field list. */
export type ForgeSort<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>
> = ForgeQueryField<S, TSlug> | { field: ForgeQueryField<S, TSlug>; order?: 'asc' | 'desc' }[];

/** {@link QueryOptions} with schema-aware `where`/`sort` and the `depth`/`locale` that shape the result. */
export type ForgeQueryOptions<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>,
  D extends 0 | 1 = 0,
  L extends string | undefined = undefined
> = Omit<QueryOptions, 'where' | 'sort' | 'depth' | 'locale'> & {
  where?: ForgeWhere<S, TSlug>;
  sort?: ForgeSort<S, TSlug>;
  /** `1` replaces relation/upload ids with the readable target (or `null`). */
  depth?: D;
  /** Resolves localized fields to one locale (with fallback); without it they are per-locale maps. */
  locale?: L;
};

/** The multipart text fields `uploadFile` may send: the collection's declared field names. */
export type ForgeUploadFields<
  S extends ForgeSchema,
  TSlug extends ForgeCollectionSlug<S> = ForgeCollectionSlug<S>
> =
  IsWide<ForgeCollectionSlug<S>> extends true
    ? Record<string, string>
    : CollectionOf<S, TSlug> extends { fields: infer TFields }
      ? { [K in Extract<keyof TFields, string>]?: string }
      : never;
