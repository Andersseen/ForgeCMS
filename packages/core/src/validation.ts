import type {
  AnyField,
  ArrayFieldOptions,
  BlocksFieldOptions,
  CollectionDefinition,
  FieldMap,
  GroupFieldOptions,
  NumberFieldOptions,
  RelationFieldOptions,
  SelectFieldOptions,
  TextFieldOptions
} from './index.js';

export interface ValidationError {
  field: string;
  message: string;
  code: ValidationErrorCode;
}

export type ValidationErrorCode =
  | 'required'
  | 'type_text'
  | 'type_number'
  | 'type_boolean'
  | 'type_date'
  | 'type_relation'
  | 'type_json'
  | 'type_select'
  | 'type_slug'
  | 'type_email'
  | 'type_textarea'
  | 'type_richtext'
  | 'type_upload'
  | 'type_group'
  | 'type_array'
  | 'type_blocks'
  | 'minRows'
  | 'maxRows'
  | 'block_type'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'relation_collection'
  | 'select_option'
  | 'slug_format'
  | 'email_format';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function createError(field: string, code: ValidationErrorCode, message: string): ValidationError {
  return { field, message, code };
}

function validateTextLike(
  field: AnyField,
  value: unknown,
  fieldName: string,
  typeCode: ValidationErrorCode,
  typeLabel: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== 'string') {
    errors.push(createError(fieldName, typeCode, `Field "${fieldName}" must be a ${typeLabel}.`));
    return errors;
  }

  const textOpts = field.options as TextFieldOptions;
  if (textOpts.minLength !== undefined && value.length < textOpts.minLength) {
    errors.push(
      createError(
        fieldName,
        'minLength',
        `Field "${fieldName}" must be at least ${textOpts.minLength} characters.`
      )
    );
  }
  if (textOpts.maxLength !== undefined && value.length > textOpts.maxLength) {
    errors.push(
      createError(
        fieldName,
        'maxLength',
        `Field "${fieldName}" must be at most ${textOpts.maxLength} characters.`
      )
    );
  }

  return errors;
}

/**
 * Structural check only: a node needs a string `type`, and — if present — `text` must be a string and
 * `children` must be an array of valid nodes. No fixed vocabulary of node types or marks is enforced.
 */
function isValidRichTextNode(node: unknown): boolean {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  const candidate = node as Record<string, unknown>;

  if (typeof candidate.type !== 'string') return false;
  if (candidate.text !== undefined && typeof candidate.text !== 'string') return false;
  if (candidate.children !== undefined) {
    return Array.isArray(candidate.children) && candidate.children.every(isValidRichTextNode);
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Row-count bounds shared by `array` and `blocks`. */
function validateRowCount(
  rows: unknown[],
  fieldName: string,
  options: { minRows?: number; maxRows?: number }
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (options.minRows !== undefined && rows.length < options.minRows) {
    errors.push(
      createError(
        fieldName,
        'minRows',
        `Field "${fieldName}" must have at least ${options.minRows} rows.`
      )
    );
  }
  if (options.maxRows !== undefined && rows.length > options.maxRows) {
    errors.push(
      createError(
        fieldName,
        'maxRows',
        `Field "${fieldName}" must have at most ${options.maxRows} rows.`
      )
    );
  }
  return errors;
}

/**
 * Validates every field in a `FieldMap` against a data object, prefixing error paths so nested
 * failures are addressable (`hero.title`, `sections.2.heading`). This is the recursion point shared
 * by collections, `group`, `array` rows and `blocks` rows.
 */
export function validateFieldMap(
  fields: FieldMap,
  data: Record<string, unknown>,
  pathPrefix = ''
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    const path = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName;
    errors.push(...validateField(fieldDef, data[fieldName], path));
  }
  return errors;
}

export function validateField(
  field: AnyField,
  value: unknown,
  fieldName: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const opts = field.options;

  // required check
  if (opts.required === true) {
    if (value === undefined || value === null || value === '') {
      errors.push(createError(fieldName, 'required', `Field "${fieldName}" is required.`));
      // If required and missing, stop further type checks
      return errors;
    }
  }

  // If value is undefined/null and not required, skip type checks
  if (value === undefined || value === null) {
    return errors;
  }

  switch (field.kind) {
    case 'text':
    case 'textarea': {
      errors.push(...validateTextLike(field, value, fieldName, 'type_text', 'string'));
      break;
    }

    case 'slug': {
      errors.push(...validateTextLike(field, value, fieldName, 'type_slug', 'slug'));
      if (typeof value === 'string') {
        const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
        if (!slugPattern.test(value)) {
          errors.push(
            createError(
              fieldName,
              'slug_format',
              `Field "${fieldName}" must be a valid slug (lowercase letters, numbers, hyphens).`
            )
          );
        }
      }
      break;
    }

    case 'email': {
      errors.push(...validateTextLike(field, value, fieldName, 'type_email', 'email'));
      if (typeof value === 'string') {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(value)) {
          errors.push(
            createError(fieldName, 'email_format', `Field "${fieldName}" must be a valid email.`)
          );
        }
      }
      break;
    }

    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(
          createError(fieldName, 'type_number', `Field "${fieldName}" must be a number.`)
        );
        break;
      }
      const numOpts = field.options as NumberFieldOptions;
      if (numOpts.min !== undefined && value < numOpts.min) {
        errors.push(
          createError(fieldName, 'min', `Field "${fieldName}" must be at least ${numOpts.min}.`)
        );
      }
      if (numOpts.max !== undefined && value > numOpts.max) {
        errors.push(
          createError(fieldName, 'max', `Field "${fieldName}" must be at most ${numOpts.max}.`)
        );
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(
          createError(fieldName, 'type_boolean', `Field "${fieldName}" must be a boolean.`)
        );
      }
      break;
    }

    case 'date': {
      let dateValue: Date | null = null;

      if (value instanceof Date) {
        dateValue = value;
      } else if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          dateValue = parsed;
        }
      } else if (typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          dateValue = parsed;
        }
      }

      if (!dateValue) {
        errors.push(
          createError(fieldName, 'type_date', `Field "${fieldName}" must be a valid date.`)
        );
      }
      break;
    }

    case 'relation': {
      const relOpts = field.options as RelationFieldOptions;
      if (relOpts.many === true) {
        if (!Array.isArray(value)) {
          errors.push(
            createError(
              fieldName,
              'type_relation',
              `Field "${fieldName}" must be an array of relation IDs.`
            )
          );
          break;
        }
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== 'string') {
            errors.push(
              createError(
                fieldName,
                'type_relation',
                `Field "${fieldName}" item at index ${i} must be a string.`
              )
            );
          }
        }
      } else {
        if (typeof value !== 'string') {
          errors.push(
            createError(
              fieldName,
              'type_relation',
              `Field "${fieldName}" must be a relation ID string.`
            )
          );
        }
      }
      break;
    }

    case 'json': {
      if (value === undefined) {
        errors.push(
          createError(fieldName, 'type_json', `Field "${fieldName}" must be valid JSON.`)
        );
      }
      // Accept any non-null value that can be serialized
      if (typeof value === 'function' || typeof value === 'symbol') {
        errors.push(
          createError(fieldName, 'type_json', `Field "${fieldName}" must be valid JSON.`)
        );
      }
      break;
    }

    case 'select': {
      if (typeof value !== 'string') {
        errors.push(
          createError(fieldName, 'type_select', `Field "${fieldName}" must be a string option.`)
        );
        break;
      }
      const selOpts = field.options as SelectFieldOptions;
      if (!selOpts.options.includes(value)) {
        errors.push(
          createError(
            fieldName,
            'select_option',
            `Field "${fieldName}" must be one of: ${selOpts.options.join(', ')}.`
          )
        );
      }
      break;
    }

    case 'richtext': {
      if (!Array.isArray(value) || !value.every(isValidRichTextNode)) {
        errors.push(
          createError(
            fieldName,
            'type_richtext',
            `Field "${fieldName}" must be a rich text document (an array of nodes).`
          )
        );
      }
      break;
    }

    case 'upload': {
      if (typeof value !== 'string') {
        errors.push(
          createError(fieldName, 'type_upload', `Field "${fieldName}" must be an upload ID string.`)
        );
      }
      break;
    }

    case 'group': {
      if (!isPlainObject(value)) {
        errors.push(
          createError(fieldName, 'type_group', `Field "${fieldName}" must be an object.`)
        );
        break;
      }
      const groupOpts = field.options as GroupFieldOptions;
      errors.push(...validateFieldMap(groupOpts.fields, value, fieldName));
      break;
    }

    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(
          createError(fieldName, 'type_array', `Field "${fieldName}" must be an array of rows.`)
        );
        break;
      }
      const arrayOpts = field.options as ArrayFieldOptions;
      errors.push(...validateRowCount(value, fieldName, arrayOpts));

      for (const [index, row] of value.entries()) {
        const rowPath = `${fieldName}.${index}`;
        if (!isPlainObject(row)) {
          errors.push(createError(rowPath, 'type_array', `Row "${rowPath}" must be an object.`));
          continue;
        }
        errors.push(...validateFieldMap(arrayOpts.fields, row, rowPath));
      }
      break;
    }

    case 'blocks': {
      if (!Array.isArray(value)) {
        errors.push(
          createError(fieldName, 'type_blocks', `Field "${fieldName}" must be an array of blocks.`)
        );
        break;
      }
      const blocksOpts = field.options as BlocksFieldOptions;
      errors.push(...validateRowCount(value, fieldName, blocksOpts));

      const bySlug = new Map(blocksOpts.blocks.map((block) => [block.slug, block]));
      for (const [index, row] of value.entries()) {
        const rowPath = `${fieldName}.${index}`;
        if (!isPlainObject(row)) {
          errors.push(createError(rowPath, 'type_blocks', `Block "${rowPath}" must be an object.`));
          continue;
        }

        const blockType = row.blockType;
        if (typeof blockType !== 'string') {
          errors.push(
            createError(rowPath, 'block_type', `Block "${rowPath}" must have a string "blockType".`)
          );
          continue;
        }

        const block = bySlug.get(blockType);
        if (!block) {
          errors.push(
            createError(
              rowPath,
              'block_type',
              `Block "${rowPath}" has unknown blockType "${blockType}". Expected one of: ${[...bySlug.keys()].join(', ')}.`
            )
          );
          continue;
        }

        errors.push(...validateFieldMap(block.fields, row, rowPath));
      }
      break;
    }
  }

  return errors;
}

export function validateCollection<TSlug extends string, TFields extends Record<string, AnyField>>(
  collection: CollectionDefinition<TSlug, TFields>,
  data: Record<string, unknown>
): ValidationResult {
  const errors = validateFieldMap(collection.fields, data);

  return {
    valid: errors.length === 0,
    errors
  };
}
