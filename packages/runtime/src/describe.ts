import type {
  AnyField,
  ArrayFieldOptions,
  BlocksFieldOptions,
  CollectionDefinition,
  FieldMap,
  GroupFieldOptions,
  RelationFieldOptions,
  SelectFieldOptions,
  UploadFieldOptions
} from '@forge-cms/core';

/** One selectable shape of a `blocks` field. Mirrors `BlockMeta` in `@forge-cms/angular`. */
export interface BlockDescription {
  slug: string;
  label: string;
  fields: FieldDescription[];
}

/**
 * The client-facing description of a field. Mirrors `FieldMeta` in `@forge-cms/angular` — the admin
 * UI builds its form from this, so composite fields have to carry their nested structure or the form
 * has no way to render them.
 */
export interface FieldDescription {
  name: string;
  kind: string;
  label: string;
  required: boolean;
  options?: string[];
  relation?: { collection: string; many: boolean };
  fields?: FieldDescription[];
  blocks?: BlockDescription[];
  minRows?: number;
  maxRows?: number;
}

export interface CollectionDescription {
  slug: string;
  name: string;
  description: string;
  fieldDefinitions: FieldDescription[];
}

function describeField(name: string, field: AnyField): FieldDescription {
  const base: FieldDescription = {
    name,
    kind: field.kind,
    label: field.options.label ?? name,
    required: field.options.required ?? false
  };

  switch (field.kind) {
    case 'select':
      return { ...base, options: (field.options as SelectFieldOptions).options };

    case 'relation': {
      const options = field.options as RelationFieldOptions;
      return { ...base, relation: { collection: options.collection, many: options.many ?? false } };
    }

    case 'upload': {
      const options = field.options as UploadFieldOptions;
      return { ...base, relation: { collection: options.collection, many: false } };
    }

    case 'group':
      return { ...base, fields: describeFields((field.options as GroupFieldOptions).fields) };

    case 'array': {
      const options = field.options as ArrayFieldOptions;
      return {
        ...base,
        fields: describeFields(options.fields),
        ...(options.minRows !== undefined && { minRows: options.minRows }),
        ...(options.maxRows !== undefined && { maxRows: options.maxRows })
      };
    }

    case 'blocks': {
      const options = field.options as BlocksFieldOptions;
      return {
        ...base,
        blocks: options.blocks.map((block) => ({
          slug: block.slug,
          label: block.label ?? block.slug,
          fields: describeFields(block.fields)
        })),
        ...(options.minRows !== undefined && { minRows: options.minRows }),
        ...(options.maxRows !== undefined && { maxRows: options.maxRows })
      };
    }

    default:
      return base;
  }
}

export function describeFields(fields: FieldMap): FieldDescription[] {
  return Object.entries(fields).map(([name, field]) => describeField(name, field));
}

export function describeCollection(collection: CollectionDefinition): CollectionDescription {
  return {
    slug: collection.slug,
    name: collection.slug.charAt(0).toUpperCase() + collection.slug.slice(1),
    description: `Content collection for ${collection.slug}`,
    fieldDefinitions: describeFields(collection.fields)
  };
}

export function describeCollections(
  collections: readonly CollectionDefinition[]
): CollectionDescription[] {
  return collections.map(describeCollection);
}
