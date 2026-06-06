import type { StorageAdapter, StorageObject, PutObjectOptions } from '@forge-cms/storage';
import type { R2Bucket, R2Object } from './bindings.js';

export interface R2Env {
  BUCKET: R2Bucket;
}

export class R2StorageAdapter implements StorageAdapter {
  readonly name = 'r2';
  private bucket?: R2Bucket;
  private publicUrlBase?: string;

  init(env: unknown): this {
    const r2Env = env as R2Env;
    if (!r2Env.BUCKET) {
      throw new Error('R2StorageAdapter requires env.BUCKET binding');
    }
    this.bucket = r2Env.BUCKET;
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

  async get(key: string): Promise<StorageObject | null> {
    const bucket = this.getBucket();
    const r2Object = await bucket.head(key);
    if (!r2Object) return null;
    return this.toStorageObject(r2Object);
  }

  async delete(key: string): Promise<void> {
    const bucket = this.getBucket();
    await bucket.delete(key);
  }

  async getPublicUrl(key: string): Promise<string> {
    if (this.publicUrlBase) {
      return `${this.publicUrlBase}/${key}`;
    }
    return `https://r2.example.com/${key}`;
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
