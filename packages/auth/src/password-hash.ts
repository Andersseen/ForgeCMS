/**
 * Versioned password hashes with a configurable work factor (spec 105).
 *
 * Two stored formats are read; both are PBKDF2-HMAC-SHA-256 over Web Crypto (Node, Workers, browsers):
 *
 * - **legacy** (1.0): `base64url(salt[16] ‖ hash[32])`, always 100 000 iterations. Still written whenever
 *   the configured work factor is the 1.0 default, so a 1.1 install that keeps the default stays readable
 *   by 1.0 (a rollback keeps every login working).
 * - **v2**: `$pbkdf2-sha256$i=<iterations>$<base64url salt>$<base64url hash>` (PHC-style). Written only when
 *   the configured work factor differs from the 1.0 default; it records its own iterations, so raising the
 *   work factor later never invalidates it.
 *
 * Internal: only {@link PasswordHashingOptions} and {@link PASSWORD_HASHING_PRESETS} are exported from the
 * package entry point.
 */

/** Work-factor configuration for `UsersCollectionAuthAdapter` (spec 105). */
export interface PasswordHashingOptions {
  /**
   * PBKDF2-HMAC-SHA-256 iterations for new hashes and the rehash-on-login target. Defaults to `100_000`
   * (the 1.0 value, unchanged). An integer between `100_000` and `10_000_000`: the floor keeps a
   * configuration from ever weakening stored hashes. Raising it is safe at any time — older hashes keep
   * verifying and are upgraded on the user's next successful login. See {@link PASSWORD_HASHING_PRESETS}.
   */
  iterations?: number;
}

/**
 * Documented work factors per deployment profile (spec 105). Measured login CPU (median, 2026-11-17,
 * Apple M4; Cloudflare edge CPUs are typically slower, so treat these as lower bounds):
 *
 * | Preset    | Iterations | local workerd | Node 22 |
 * | --------- | ---------- | ------------- | ------- |
 * | `workers` | 100 000    | ≈ 5.7 ms      | ≈ 7 ms  |
 * | `node`    | 600 000    | ≈ 35 ms       | ≈ 45 ms |
 *
 * `workers` is the default and the only one that can fit the Workers Free plan's 10 ms CPU limit. `node`
 * follows OWASP's PBKDF2-HMAC-SHA-256 recommendation (600 000) and suits a Node server or a paid Workers
 * plan. A login that upgrades a hash pays two derivations once.
 */
export const PASSWORD_HASHING_PRESETS = Object.freeze({
  workers: Object.freeze({ iterations: 100_000 }),
  node: Object.freeze({ iterations: 600_000 })
} satisfies Record<string, Required<PasswordHashingOptions>>);

/** The 1.0 work factor, and the iterations of every legacy hash. */
export const LEGACY_ITERATIONS = 100_000;
const MIN_ITERATIONS = LEGACY_ITERATIONS;
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const KEY_BYTES = KEY_BITS / 8;
const V2_PREFIX = '$pbkdf2-sha256$i=';
const DUMMY_SALT = new Uint8Array(new ArrayBuffer(SALT_BYTES)).fill(0x5a);

export interface PasswordHashParams {
  iterations: number;
}

/** Validates the configured work factor once, at construction. */
export function resolvePasswordHashing(
  options: PasswordHashingOptions | undefined
): PasswordHashParams {
  const iterations = options?.iterations ?? LEGACY_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error(
      `UsersCollectionAuthAdapter: passwordHashing.iterations must be an integer between ` +
        `${MIN_ITERATIONS} and ${MAX_ITERATIONS}.`
    );
  }
  return { iterations };
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Either stored format, or `null` for anything malformed (which never verifies). */
export function parsePasswordHash(stored: string): ParsedHash | null {
  if (stored.startsWith(V2_PREFIX)) {
    const [iterationsText, saltText, hashText, ...extra] = stored
      .slice(V2_PREFIX.length)
      .split('$');
    if (
      extra.length > 0 ||
      iterationsText === undefined ||
      saltText === undefined ||
      hashText === undefined
    ) {
      return null;
    }
    if (!/^[1-9]\d{0,7}$/.test(iterationsText)) return null;
    const iterations = Number(iterationsText);
    const salt = base64UrlDecode(saltText);
    const hash = base64UrlDecode(hashText);
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
    if (!salt || salt.length !== SALT_BYTES || !hash || hash.length !== KEY_BYTES) return null;
    return { iterations, salt, hash };
  }
  const combined = base64UrlDecode(stored);
  if (!combined || combined.length !== SALT_BYTES + KEY_BYTES) return null;
  return {
    iterations: LEGACY_ITERATIONS,
    salt: combined.slice(0, SALT_BYTES),
    hash: combined.slice(SALT_BYTES)
  };
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return new Uint8Array(derived);
}

/** Compares every byte regardless of where the first difference is. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}

/** A new hash at `params`: the legacy format at the 1.0 work factor, v2 otherwise. */
export async function hashPassword(password: string, params: PasswordHashParams): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)));
  const hash = await derive(password, salt, params.iterations);
  if (params.iterations === LEGACY_ITERATIONS) {
    const combined = new Uint8Array(SALT_BYTES + KEY_BYTES);
    combined.set(salt);
    combined.set(hash, SALT_BYTES);
    return base64UrlEncode(combined);
  }
  return `${V2_PREFIX}${params.iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

/**
 * Verifies `password` against a stored hash in either format. With no stored hash (unknown account) or a
 * malformed one, one derivation at the configured work factor still runs against a fixed salt and the
 * result is `false`, so those cases pay the same password work as a wrong password at the target cost.
 */
export async function verifyPassword(
  password: string,
  stored: string | undefined,
  params: PasswordHashParams
): Promise<boolean> {
  const parsed = stored === undefined ? null : parsePasswordHash(stored);
  if (!parsed) {
    // A fixed salt: the result is discarded, only the work matters, and a failed login draws no
    // randomness (spec 069).
    await derive(password, DUMMY_SALT, params.iterations);
    return false;
  }
  return timingSafeEqual(await derive(password, parsed.salt, parsed.iterations), parsed.hash);
}

/** A stored hash is upgraded on login only when its work factor is below the configured one. */
export function needsRehash(stored: string, params: PasswordHashParams): boolean {
  const parsed = parsePasswordHash(stored);
  return parsed !== null && parsed.iterations < params.iterations;
}
