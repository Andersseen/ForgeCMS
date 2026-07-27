import type { FieldMeta } from '@forge-cms/angular';

function toId(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return String((value as Record<string, unknown>).id ?? '');
  }
  return value;
}

/**
 * Turns populated `relation`/`upload` values back into ids.
 *
 * A caller that lists with `depth: 1` (which the admin does, so cells can show names and
 * thumbnails) hands this form documents whose relations are whole objects. Submitting those would
 * write an object into a column that stores an id — so the form normalises them on the way in.
 */
export function normaliseReferences(
  fields: FieldMeta[],
  value: Record<string, unknown>
): Record<string, unknown> {
  let result = value;

  for (const field of fields) {
    if (field.kind !== 'relation' && field.kind !== 'upload') continue;
    const current = result[field.name];
    if (current === undefined || current === null) continue;

    let normalised: unknown;
    if (Array.isArray(current)) {
      const ids = current.map(toId);
      // Keep the original array when nothing was populated, so an untouched document stays `===`
      // and the form does not churn a new object on every change-detection pass.
      normalised = ids.every((id, index) => id === current[index]) ? current : ids;
    } else {
      normalised = toId(current);
    }
    if (normalised === current) continue;

    if (result === value) result = { ...value };
    result[field.name] = normalised;
  }

  return result;
}
