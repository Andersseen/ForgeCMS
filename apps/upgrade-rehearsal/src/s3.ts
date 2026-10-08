import { S3StorageAdapter } from '@forge-cms/s3';
import type { StorageAdapter } from '@forge-cms/storage';

/**
 * The real S3-compatible service of the recovery rehearsal (spec 084): the isolated Garage container that
 * `pnpm test:s3` starts, with the buckets it provisioned. Provisioning is orchestration, never the adapter's
 * job — this file only *uses* buckets that already exist.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run this suite through \`pnpm test:s3 recovery\`, which starts the Garage service.`
    );
  }
  return value;
}

export const S3_SERVICE = {
  endpoint: required('FORGE_S3_TEST_ENDPOINT'),
  region: required('FORGE_S3_TEST_REGION'),
  accessKeyId: required('FORGE_S3_TEST_ACCESS_KEY_ID'),
  secretAccessKey: required('FORGE_S3_TEST_SECRET_ACCESS_KEY'),
  image: required('FORGE_S3_TEST_IMAGE'),
  buckets: required('FORGE_S3_TEST_RECOVERY_BUCKETS').split(',')
};

export function s3Storage(bucket: string): S3StorageAdapter {
  return new S3StorageAdapter({
    bucket,
    region: S3_SERVICE.region,
    endpoint: S3_SERVICE.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: S3_SERVICE.accessKeyId,
      secretAccessKey: S3_SERVICE.secretAccessKey
    }
  });
}

let allocated = 0;

/**
 * Hands out a bucket nobody has used in this run and proves it starts empty. Each source and each restore
 * target gets its own, so a restore can never lean on (or overwrite) the source.
 */
export async function freshBucket(): Promise<{ bucket: string; storage: S3StorageAdapter }> {
  const bucket = S3_SERVICE.buckets[allocated++];
  if (bucket === undefined) throw new Error('the recovery test ran out of provisioned buckets');
  const storage = s3Storage(bucket);
  const existing = await storage.list();
  if (existing.length > 0) throw new Error(`bucket ${bucket} is not empty at the start`);
  return { bucket, storage };
}

/** Removes every object (the "source is gone" step: the bucket itself is infrastructure, not ours). */
export async function emptyBucket(storage: StorageAdapter): Promise<void> {
  for (const object of await storage.list()) await storage.delete(object.key);
}
