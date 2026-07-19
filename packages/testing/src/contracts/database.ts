import { beforeEach, describe, expect, it } from 'vitest';

interface ContractDatabaseAdapter {
  readonly name: string;
  init(env?: unknown): unknown;
  findById(collection: string, id: string): Promise<Record<string, unknown> | null>;
  findMany(options: {
    collection: string;
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
  }): Promise<Record<string, unknown>[]>;
  create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown>>;
  count(collection: string): Promise<number>;
  delete(collection: string, id: string): Promise<void>;
  syncSchema(collections: unknown[]): Promise<void>;
}

export function runDatabaseAdapterContractTests(createAdapter: () => ContractDatabaseAdapter) {
  describe('DatabaseAdapter contract', () => {
    let adapter: ContractDatabaseAdapter;

    beforeEach(() => {
      adapter = createAdapter();
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('creates a record with auto-generated id', async () => {
      const data = { title: 'Hello' };
      const result = await adapter.create('posts', data);
      expect(result.id).toBeTruthy();
      expect(typeof result.id).toBe('string');
      expect(result.title).toBe('Hello');
    });

    it('creates a record with provided id', async () => {
      const data = { id: '1', title: 'Hello' };
      const result = await adapter.create('posts', data);
      expect(result).toEqual(expect.objectContaining(data));
    });

    it('finds a record by id', async () => {
      const data = { id: '2', title: 'World' };
      await adapter.create('posts', data);
      const found = await adapter.findById('posts', '2');
      expect(found).toEqual(expect.objectContaining(data));
    });

    it('returns null when record not found', async () => {
      const found = await adapter.findById('posts', 'nonexistent');
      expect(found).toBeNull();
    });

    it('finds many records', async () => {
      await adapter.create('posts', { id: '3', title: 'A' });
      await adapter.create('posts', { id: '4', title: 'B' });
      const results = await adapter.findMany({ collection: 'posts' });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('finds many with limit', async () => {
      await adapter.create('posts', { id: '5', title: 'C' });
      await adapter.create('posts', { id: '6', title: 'D' });
      const results = await adapter.findMany({ collection: 'posts', limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('updates a record', async () => {
      await adapter.create('posts', { id: '7', title: 'Old' });
      const updated = await adapter.update('posts', '7', { title: 'New' });
      expect(updated).toEqual(expect.objectContaining({ id: '7', title: 'New' }));
    });

    it('deletes a record', async () => {
      await adapter.create('posts', { id: '8', title: 'ToDelete' });
      await adapter.delete('posts', '8');
      const found = await adapter.findById('posts', '8');
      expect(found).toBeNull();
    });

    it('counts records', async () => {
      await adapter.create('posts', { id: '9', title: 'Countable' });
      const count = await adapter.count('posts');
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });
}
