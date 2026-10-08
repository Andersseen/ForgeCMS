import { S3_ENV_KEYS, parseS3Config, type S3Config, type S3Env } from './storage';

/**
 * The deployment-profile policy of this fixture (spec 084, roadmap 0.10 / P03). It belongs to the *consumer*,
 * not to ForgeCMS: the runtime happily accepts any adapter combination, including in-memory ones. A consumer
 * that wants a durable production decides it once, here, and fails at startup instead of silently losing data.
 *
 * Two official durable profiles, each complete or not selected at all:
 *
 *   cloudflare   `DB` (D1) + `BUCKET` (R2)                       → D1DatabaseAdapter + R2StorageAdapter
 *   portable     `DATABASE_URL` (libSQL) + `S3_BUCKET`/`S3_REGION` → LibSqlDatabaseAdapter + S3StorageAdapter
 *
 * A production build (`import.meta.dev !== true`) must select exactly one of them. Only development may use the
 * in-memory adapters, and that carries no durability claim. Error messages name variables and bindings, never
 * their values.
 */
export interface ProfileEnv extends S3Env {
  DB?: unknown;
  BUCKET?: unknown;
  DATABASE_URL?: string;
  AUTH_SECRET?: string;
}

export type DatabaseKind = 'd1' | 'libsql' | 'memory';
export type StorageKind = 'r2' | 's3' | 'memory';

export interface ResolvedProfile {
  /** `development`: in-memory adapters are possible and nothing is durable. */
  name: 'cloudflare' | 'portable' | 'development';
  database: DatabaseKind;
  storage: StorageKind;
  s3?: S3Config;
}

const blank = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' && value.trim() === '');

const GUIDE =
  'Set DB + BUCKET (Cloudflare D1 + R2), or DATABASE_URL + S3_BUCKET + S3_REGION (libSQL + S3-compatible storage).';

/**
 * Decides the database and storage of this deployment.
 *
 * - production: exactly one complete durable profile, else a clear startup error;
 * - development: a durable adapter is used when its setting is present (so `DATABASE_URL=… pnpm dev` works),
 *   otherwise the in-memory adapter — the old behaviour, explicitly limited to `import.meta.dev`.
 */
export function resolveProfile(
  env: ProfileEnv | undefined,
  options: { development: boolean }
): ResolvedProfile {
  const hasD1 = !blank(env?.DB);
  const hasR2 = !blank(env?.BUCKET);
  const hasLibsql = !blank(env?.DATABASE_URL);
  const s3Present = S3_ENV_KEYS.filter((key) => !blank(env?.[key]));
  const hasS3 = s3Present.length > 0;

  if (options.development) {
    const s3 = parseS3Config(env);
    return {
      name: hasD1 || hasR2 ? 'cloudflare' : hasLibsql || hasS3 ? 'portable' : 'development',
      database: hasD1 ? 'd1' : hasLibsql ? 'libsql' : 'memory',
      storage: hasR2 ? 'r2' : s3 ? 's3' : 'memory',
      ...(!hasR2 && s3 && { s3 })
    };
  }

  const cloudflareSet = [hasD1 && 'DB', hasR2 && 'BUCKET'].filter(Boolean) as string[];
  const portableSet = [hasLibsql && 'DATABASE_URL', ...s3Present].filter(Boolean) as string[];

  if (cloudflareSet.length > 0 && portableSet.length > 0) {
    throw new Error(
      `Ambiguous deployment profile: Cloudflare settings (${cloudflareSet.join(', ')}) and portable settings ` +
        `(${portableSet.join(', ')}) are both present. Configure exactly one durable profile. ${GUIDE}`
    );
  }
  if (cloudflareSet.length === 0 && portableSet.length === 0) {
    throw new Error(
      `No durable deployment profile is configured, and a production build never falls back to in-memory ` +
        `storage (data would be lost on every restart). ${GUIDE}`
    );
  }
  if (cloudflareSet.length > 0) {
    const missing = [!hasD1 && 'DB', !hasR2 && 'BUCKET'].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `Incomplete Cloudflare profile: missing ${missing.join(', ')} (present: ${cloudflareSet.join(', ')}). ` +
          'It needs both the D1 binding DB and the R2 binding BUCKET.'
      );
    }
    return { name: 'cloudflare', database: 'd1', storage: 'r2' };
  }
  const s3 = parseS3Config(env); // throws, naming variables, on a partial/malformed S3 configuration
  const missing = [!hasLibsql && 'DATABASE_URL', !s3 && 'S3_BUCKET and S3_REGION'].filter(Boolean);
  if (missing.length > 0 || !s3) {
    throw new Error(
      `Incomplete portable profile: missing ${missing.join(', ')} (present: ${portableSet.join(', ')}). ` +
        'It needs DATABASE_URL (libSQL) and a complete S3 configuration (S3_BUCKET + S3_REGION).'
    );
  }
  return { name: 'portable', database: 'libsql', storage: 's3', s3 };
}
