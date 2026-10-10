import { describe, expect, it } from 'vitest';
import { runStorageAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryStorageAdapter } from './in-memory.adapter.js';

runStorageAdapterContractTests(() => new InMemoryStorageAdapter());

describe('InMemoryStorageAdapter public URLs', () => {
  it('points at the file handler path by default and honours a configured base', async () => {
    const adapter = new InMemoryStorageAdapter().init();
    expect(await adapter.getPublicUrl('media/a b/c.txt')).toBe('/api/media/media/a%20b/c.txt');

    adapter.setPublicUrlBase('https://cdn.example.test/files/');
    expect(await adapter.getPublicUrl('media/c.txt')).toBe(
      'https://cdn.example.test/files/media/c.txt'
    );
  });
});
