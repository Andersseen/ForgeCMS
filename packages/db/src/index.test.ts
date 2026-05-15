import { describe, expect, it } from 'vitest';
import type { DatabaseAdapter } from './index';

describe('DatabaseAdapter', () => {
  it('describes the adapter contract', () => {
    const adapterName: DatabaseAdapter['name'] = 'memory';

    expect(adapterName).toBe('memory');
  });
});
