import type { PutObjectOptions, StorageAdapter, StorageObject } from './index.js';

async function readBody(
  body: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>
): Promise<ArrayBuffer> {
  if (body instanceof ArrayBuffer) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }

  if (body instanceof Blob) {
    return await body.arrayBuffer();
  }

  // ReadableStream
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength
  ) as ArrayBuffer;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  readonly name = 'in-memory';
  private store: Map<string, StorageObject> = new Map();
  private publicUrlBase = '/api/media';

  init(): this {
    return this;
  }

  /**
   * Where {@link getPublicUrl} points. Defaults to `/api/media`, matching `handleFile` from
   * `@forge-cms/runtime` — a relative path an app can actually serve. It used to be
   * `https://forge.test/storage/...`, a domain that does not exist, so every locally uploaded file
   * rendered as a broken image.
   */
  setPublicUrlBase(base: string): void {
    this.publicUrlBase = base.replace(/\/$/, '');
  }

  async put(options: PutObjectOptions): Promise<StorageObject> {
    const body = await readBody(options.body);

    const obj: StorageObject = {
      key: options.key,
      body,
      size: body.byteLength
    };

    if (options.contentType !== undefined) {
      obj.contentType = options.contentType;
    }

    if (options.metadata !== undefined) {
      obj.metadata = options.metadata;
    }

    this.store.set(options.key, obj);
    return obj;
  }

  async get(key: string): Promise<StorageObject | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getPublicUrl(key: string): Promise<string> {
    return `${this.publicUrlBase}/${key}`;
  }

  async list(prefix?: string): Promise<StorageObject[]> {
    const all = Array.from(this.store.values());
    if (!prefix) return all;
    return all.filter((obj) => obj.key.startsWith(prefix));
  }
}
