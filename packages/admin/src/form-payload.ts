/**
 * Forge-owned document metadata (spec 063). The runtime refuses any change to these through the CMS
 * mutation API and only tolerates an unchanged echo, so the form never submits them: a document it read
 * earlier may carry a stale `updated_at` by the time it is saved.
 */
const FORGE_OWNED_KEYS = ['id', 'created_at', 'updated_at', '_storageKey'];

/** The form value as a create/update payload: everything except Forge-owned metadata. */
export function toSubmitPayload(value: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...value };
  for (const key of FORGE_OWNED_KEYS) delete payload[key];
  return payload;
}
