import type { StorageAdapter } from '@forge-cms/storage';

/**
 * Host-owned configuration of the optional portable S3 storage profile (spec 083). Server-side only: these
 * values never reach browser code. Which storage a deployment uses is decided by `profile.ts`.
 */
export interface S3Env {
  S3_BUCKET?: string;
  S3_REGION?: string;
  /** Custom S3-compatible endpoint (Garage, B2, Wasabi, …); omit for AWS S3. */
  S3_ENDPOINT?: string;
  /** Static credentials come as a pair; omit both to use the AWS SDK's provider chain. */
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_SESSION_TOKEN?: string;
  /** `true` / `false`; default `false`. Path-style addressing is what most S3-compatible services need. */
  S3_FORCE_PATH_STYLE?: string;
  /** Browser-visible URL base of a file; default `/api/media` (the access-checked `handleFile` route). */
  S3_PUBLIC_URL_BASE?: string;
}

export const S3_ENV_KEYS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_SESSION_TOKEN',
  'S3_FORCE_PATH_STYLE',
  'S3_PUBLIC_URL_BASE'
] as const satisfies readonly (keyof S3Env)[];

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  forcePathStyle: boolean;
  publicUrlBase?: string;
}

const blank = (value: string | undefined) => value === undefined || value.trim() === '';

/**
 * `null` when no S3 setting is present (in-memory storage). Any S3 setting makes the profile explicit, and
 * an incomplete one throws — a half-configured bucket must not silently turn into a different adapter.
 * Error messages name variables, never values.
 */
export function parseS3Config(env: S3Env | undefined): S3Config | null {
  const present = S3_ENV_KEYS.filter((key) => !blank(env?.[key]));
  if (present.length === 0) return null;

  const bucket = env?.S3_BUCKET?.trim();
  const region = env?.S3_REGION?.trim();
  if (!bucket || !region) {
    throw new Error(
      `Incomplete S3 storage configuration: S3_BUCKET and S3_REGION are both required (set: ${present.join(', ')}).`
    );
  }
  const accessKeyId = env?.S3_ACCESS_KEY_ID;
  const secretAccessKey = env?.S3_SECRET_ACCESS_KEY;
  const sessionToken = env?.S3_SESSION_TOKEN;
  if (blank(accessKeyId) !== blank(secretAccessKey)) {
    throw new Error(
      'Incomplete S3 credentials: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY go together.'
    );
  }
  const hasCredentials = !blank(accessKeyId);
  if (!hasCredentials && !blank(sessionToken)) {
    throw new Error('S3_SESSION_TOKEN requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  }

  const style = env?.S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  if (style !== undefined && style !== '' && style !== 'true' && style !== 'false') {
    throw new Error("S3_FORCE_PATH_STYLE must be 'true' or 'false'.");
  }

  const endpoint = env?.S3_ENDPOINT?.trim();
  const publicUrlBase = env?.S3_PUBLIC_URL_BASE?.trim();
  return {
    bucket,
    region,
    forcePathStyle: style === 'true',
    ...(endpoint && { endpoint }),
    ...(hasCredentials && {
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        ...(!blank(sessionToken) && { sessionToken: sessionToken! })
      }
    }),
    ...(publicUrlBase && { publicUrlBase })
  };
}

/**
 * Builds the S3 adapter for a validated configuration. The in-memory / R2 choices are made by the deployment
 * profile (`profile.ts`), which is also what refuses a production build without durable storage.
 */
export async function createS3Storage(config: S3Config): Promise<StorageAdapter> {
  // Loaded only when configured, so the AWS SDK is never evaluated by a deployment that does not use it.
  const { S3StorageAdapter } = await import('@forge-cms/s3');
  return new S3StorageAdapter(config);
}
