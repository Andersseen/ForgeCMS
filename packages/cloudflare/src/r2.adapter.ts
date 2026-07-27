import type { StorageAdapter, StorageObject, PutObjectOptions } from '@forge-cms/storage';
import type { R2Bucket, R2Object } from './bindings.js';

export interface R2Env {
  BUCKET: R2Bucket;
}

export interface R2AdapterOptions {
  /** Which binding on `env` holds the bucket. Defaults to `'BUCKET'`. */
  binding?: string;
  /**
   * Base URL stored objects are publicly reachable at — a bucket's custom domain, or a CDN.
   * Defaults to {@link DEFAULT_PUBLIC_URL_BASE}.
   */
  publicUrlBase?: string;
}

/**
 * Where `getPublicUrl` points when nothing else is configured: the path `handleFile` from
 * `@forge-cms/runtime` is meant to be mounted on, matching `InMemoryStorageAdapter`.
 *
 * It used to be `https://r2.example.com/<key>` — a domain that does not exist, so every uploaded
 * file was stored successfully and then rendered as a broken image.
 */
const DEFAULT_PUBLIC_URL_BASE = '/api/media';

export class R2StorageAdapter implements StorageAdapter {
  readonly name = 'r2';
  private bucket?: R2Bucket;
  private readonly binding: string;
  private publicUrlBase: string = DEFAULT_PUBLIC_URL_BASE;

  constructor(options: R2AdapterOptions = {}) {
    this.binding = options.binding ?? 'BUCKET';
    if (options.publicUrlBase !== undefined) {
      this.publicUrlBase = options.publicUrlBase.replace(/\/$/, '');
    }
  }

  init(env: unknown): this {
    const bindings = (env ?? {}) as Record<string, R2Bucket | undefined>;
    const bucket = bindings[this.binding];
    if (!bucket) {
      throw new Error(`R2StorageAdapter requires env.${this.binding} binding`);
    }
    this.bucket = bucket;
    return this;
  }

  setPublicUrlBase(base: string): void {
    this.publicUrlBase = base.replace(/\/$/, '');
  }

  private getBucket(): R2Bucket {
    if (!this.bucket) throw new Error('R2StorageAdapter not initialized. Call init() first.');
    return this.bucket;
  }

  async put(options: PutObjectOptions): Promise<StorageObject> {
    const bucket = this.getBucket();
    const r2Object = await bucket.put(options.key, options.body, {
      ...(options.metadata !== undefined && { customMetadata: options.metadata }),
      ...(options.contentType !== undefined && {
        httpMetadata: { contentType: options.contentType }
      })
    });
    return this.toStorageObject(r2Object);
  }

  /**
   * Reads an object **with its bytes**.
   *
   * This used to call `bucket.head()`, which returns metadata only — so `body` was always
   * undefined and anything trying to serve a stored file (`handleFile`, an image tag) got nothing
   * back. The adapter was effectively write-only. `runStorageAdapterContractTests` now covers it.
   */
  async get(key: string): Promise<StorageObject | null> {
    const bucket = this.getBucket();
    const r2Object = await bucket.get(key);
    if (!r2Object) return null;

    return { ...this.toStorageObject(r2Object), body: await r2Object.arrayBuffer() };
  }

  /** Metadata only, without transferring the object. */
  async head(key: string): Promise<StorageObject | null> {
    const r2Object = await this.getBucket().head(key);
    return r2Object ? this.toStorageObject(r2Object) : null;
  }

  async delete(key: string): Promise<void> {
    const bucket = this.getBucket();
    await bucket.delete(key);
  }

  async getPublicUrl(key: string): Promise<string> {
    return `${this.publicUrlBase}/${key}`;
  }

  async list(prefix?: string): Promise<StorageObject[]> {
    const bucket = this.getBucket();
    const result = await bucket.list({
      limit: 1000,
      ...(prefix !== undefined && { prefix })
    });
    return result.objects.map((obj) => this.toStorageObject(obj));
  }

  private toStorageObject(r2Object: R2Object): StorageObject {
    return {
      key: r2Object.key,
      size: r2Object.size,
      ...(r2Object.httpMetadata?.contentType !== undefined && {
        contentType: r2Object.httpMetadata.contentType
      }),
      metadata: r2Object.customMetadata
    };
  }
}
