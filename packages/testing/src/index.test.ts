import { describe, expect, it } from 'vitest';
import { createTestCollection, createTestRequest } from './index';

describe('testing helpers', () => {
  it('creates reusable test fixtures', () => {
    const collection = createTestCollection();
    const request = createTestRequest();

    expect(collection.slug).toBe('test-posts');
    expect(request.url).toBe('https://forge.test/');
  });
});
