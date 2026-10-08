import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import type { PutObjectOptions, StorageAdapter, StorageObject } from '@forge-cms/storage';

export interface S3StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3StorageAdapterOptions {
  bucket: string;
  region: string;

  /**
   * Custom S3-compatible endpoint.
   * Omit for ordinary AWS S3.
   */
  endpoint?: string;

  /**
   * Explicit static credentials.
   * When omitted, allow the AWS SDK's normal server-side credential resolution.
   */
  credentials?: S3StorageCredentials;

  /**
   * AWS SDK v3 `forcePathStyle`.
   * Default false.
   * Useful for services such as local Garage where configured.
   */
  forcePathStyle?: boolean;

  /**
   * Browser-visible URL base.
   * Defaults to `/api/media`, preserving Forge's access-checked `handleFile` path.
   */
  publicUrlBase?: string;
}

/** The path `handleFile` from `@forge-cms/runtime` is meant to be mounted on (same as InMemory/R2). */
const DEFAULT_PUBLIC_URL_BASE = '/api/media';

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`S3StorageAdapter: ${label} is required and must be a non-empty string`);
  }
  return value;
}

/** Validates a custom endpoint without echoing it (it may embed credentials as `user:pass@host`). */
function requireEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('S3StorageAdapter: endpoint must be an absolute http: or https: URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('S3StorageAdapter: endpoint must be an absolute http: or https: URL');
  }
  return value;
}

async function toBytes(body: PutObjectOptions['body']): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * True only for "this key does not exist". A missing *bucket* is also an HTTP 404 (`NoSuchBucket`)
 * but is a configuration/infrastructure fault, not a missing object — it must reject, as must 403,
 * credential, network and 5xx failures (spec 082 §get).
 */
function isMissingObject(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(options: S3StorageAdapterOptions) {
    this.bucket = requireText(options.bucket, 'bucket');
    const region = requireText(options.region, 'region');
    const endpoint = options.endpoint !== undefined ? requireEndpoint(options.endpoint) : undefined;

    const credentials = options.credentials;
    if (credentials !== undefined) {
      requireText(credentials.accessKeyId, 'credentials.accessKeyId');
      requireText(credentials.secretAccessKey, 'credentials.secretAccessKey');
    }

    this.publicUrlBase = (options.publicUrlBase ?? DEFAULT_PUBLIC_URL_BASE).replace(/\/+$/, '');

    this.client = new S3Client({
      region,
      forcePathStyle: options.forcePathStyle ?? false,
      ...(endpoint !== undefined && { endpoint }),
      ...(credentials !== undefined && {
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken !== undefined && {
            sessionToken: credentials.sessionToken
          })
        }
      })
    });
  }

  /** Configuration is complete at construction; there is no per-request environment to bind. */
  init(_env?: unknown): this {
    return this;
  }

  async put(options: PutObjectOptions): Promise<StorageObject> {
    const bytes = await toBytes(options.body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ...(options.contentType !== undefined && { ContentType: options.contentType }),
        ...(options.metadata !== undefined && { Metadata: options.metadata })
      })
    );
    return {
      key: options.key,
      size: bytes.byteLength,
      ...(options.contentType !== undefined && { contentType: options.contentType }),
      ...(options.metadata !== undefined && { metadata: options.metadata })
    };
  }

  async get(key: string): Promise<StorageObject | null> {
    let response;
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (isMissingObject(err)) return null;
      throw err;
    }
    if (!response.Body) {
      throw new Error(`S3StorageAdapter: object "${key}" was returned without a body`);
    }
    const bytes = await response.Body.transformToByteArray();
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return {
      key,
      body,
      size: bytes.byteLength,
      ...(response.ContentType !== undefined && { contentType: response.ContentType }),
      ...(response.Metadata !== undefined && { metadata: response.Metadata })
    };
  }

  /** S3 deletes are idempotent: a missing key resolves. Every other failure rejects. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Percent-encodes each key segment and keeps `/` as the hierarchy separator, so
   * `media/id-my photo #1.png` → `<base>/media/id-my%20photo%20%231.png`. `handleFile` decodes it.
   */
  async getPublicUrl(key: string): Promise<string> {
    return `${this.publicUrlBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Returns every matching object; provider pages (1000 keys each) are followed transparently. */
  async list(prefix?: string): Promise<StorageObject[]> {
    const objects: StorageObject[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ...(prefix !== undefined && prefix !== '' && { Prefix: prefix }),
          ...(continuationToken !== undefined && { ContinuationToken: continuationToken })
        })
      );
      for (const item of page.Contents ?? []) {
        if (item.Key === undefined) continue;
        objects.push({ key: item.Key, ...(item.Size !== undefined && { size: item.Size }) });
      }
      if (page.IsTruncated) {
        if (!page.NextContinuationToken) {
          throw new Error('S3StorageAdapter: truncated list response without a continuation token');
        }
        continuationToken = page.NextContinuationToken;
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken !== undefined);
    return objects;
  }
}
