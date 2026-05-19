import { type PutObjectOptions, type StorageAdapter, type StorageObject } from '@forge-cms/storage';

export class InMemoryStorageAdapter implements StorageAdapter {
  readonly name = 'in-memory';
  private store: Map<string, StorageObject> = new Map();

  async put(options: PutObjectOptions): Promise<StorageObject> {
    const obj: StorageObject = { key: options.key };
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
    return `https://forge.test/storage/${key}`;
  }
}
