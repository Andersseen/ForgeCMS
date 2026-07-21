import type {
  AnyField,
  CollectionDefinition,
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
  }

  return errors;
}

export function validateCollection<TSlug extends string, TFields extends Record<string, AnyField>>(
  collection: CollectionDefinition<TSlug, TFields>,
  data: Record<string, unknown>
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const [fieldName, fieldDef] of Object.entries(collection.fields)) {
    const value = data[fieldName];
    const fieldErrors = validateField(fieldDef, value, fieldName);
    errors.push(...fieldErrors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
