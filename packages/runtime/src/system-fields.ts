import { InvalidInputError } from './errors.js';

/**
 * Forge-owned document metadata (spec 063): never content, never written through the CMS mutation
 * pipeline by a caller or a hook. `_status` is deliberately absent — on a `drafts: true` collection it
 * is lifecycle input and stays writable. Raw `DatabaseAdapter` writes are outside this boundary.
 */
export const FORGE_OWNED_KEYS: readonly string[] = [
  'id',
  'created_at',
  'updated_at',
  '_storageKey'
];

/** `null` and absent are the same stored value — echoing a missing key back as `null` is a no-op. */
function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Returns `data` without the Forge-owned keys that merely echo `stored` (the document as it is — `{}`
 * for a document that does not exist yet), calling `reject(key)` for any other value. An echo is a
 * no-op, so a client round-tripping the document it read keeps working; a changed value is a write
 * attempt and is refused rather than silently stripped.
 */
function screen(
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
  reject: (key: string) => Error
): Record<string, unknown> {
  let screened = data;
  for (const key of FORGE_OWNED_KEYS) {
    if (!Object.hasOwn(data, key)) continue;
    if (!sameValue(data[key], stored[key])) throw reject(key);
    if (screened === data) screened = { ...data };
    delete screened[key];
  }
  return screened;
}

function callerRejection(key: string): InvalidInputError {
  return new InvalidInputError(`Field '${key}' is managed by Forge and cannot be written`);
}

/**
 * The caller-input screen for an update (or an update-mode preview / an existing global): echoes of
 * `existing` are dropped, any other Forge-owned value is a `400`.
 */
export function screenUpdateInput(
  data: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  return screen(data, existing, callerRejection);
}

/**
 * The caller-input screen for a create. A trusted caller (`overrideAccess` not `false`) may choose the
 * new document's `id` — a non-empty string, returned separately so hooks never see or change it; every
 * other Forge-owned key (and an untrusted caller's `id`) is a `400`.
 */
export function screenCreateInput(
  data: Record<string, unknown>,
  trusted: boolean
): { content: Record<string, unknown>; id: string | undefined } {
  const { id, ...rest } = data;
  if (id !== undefined && id !== null) {
    if (!trusted) throw callerRejection('id');
    if (typeof id !== 'string' || id === '') {
      throw new InvalidInputError(`Field 'id' must be a non-empty string`);
    }
  }
  return {
    content: screen(rest, {}, callerRejection),
    id: typeof id === 'string' ? id : undefined
  };
}

/**
 * Screens what a hook stage returned: hooks may change content and `_status`, never Forge-owned
 * metadata. Echoes of `stored` (e.g. a hook returning `{ ...previousData, ...data }`) are dropped; any
 * other value is a server-code bug, reported as a plain `Error` (500) rather than the caller's `400`.
 */
export function screenHookOutput(
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
  stage: string,
  target: string
): Record<string, unknown> {
  return screen(
    data,
    stored,
    (key) =>
      new Error(
        `${stage} hook on '${target}' set the Forge-owned field '${key}'; hooks may only change ` +
          `content fields and _status (spec 063)`
      )
  );
}
