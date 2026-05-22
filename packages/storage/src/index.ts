export { InMemoryStorageAdapter } from './in-memory.adapter.js';

export interface StorageObject {
  key: string;
  url?: string;
  contentType?: string;
  size?: number;
  metadata?: Record<string, string>;
  body?: ArrayBuffer;
}

export interface PutObjectOptions {
  key: string;
  body: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StorageAdapter {
  readonly name: string;
  init(env?: unknown): this;
  put(options: PutObjectOptions): Promise<StorageObject>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): Promise<string>;
  list(prefix?: string): Promise<StorageObject[]>;
}
