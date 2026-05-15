import { describe, expect, it } from 'vitest';
import { postFields, posts } from './posts.collection';

describe('playground posts collection', () => {
  it('declares an example collection with core', () => {
    expect(posts.slug).toBe('posts');
    expect(postFields.map((field) => field.name)).toContain('title');
  });
});
