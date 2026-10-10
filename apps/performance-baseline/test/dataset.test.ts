import { describe, expect, it } from 'vitest';
import { DATASET, FIXTURE_VERSION, generateDataset } from '../src/dataset.js';
import { createFixture } from '../src/fixture.js';

describe('performance fixture dataset', () => {
  it('is a pure function of the seed: two generations are identical', () => {
    expect(generateDataset()).toEqual(generateDataset());
  });

  it('has the documented shape', () => {
    const data = generateDataset();
    expect(FIXTURE_VERSION).toBe('r02-1');
    expect(data.authors).toHaveLength(DATASET.authors);
    expect(data.tags).toHaveLength(DATASET.tags);
    expect(data.media).toHaveLength(DATASET.media);
    expect(data.posts).toHaveLength(DATASET.posts);
    expect(new Set(data.posts.map((p) => p['rank'])).size).toBe(DATASET.posts); // rank is a permutation
    expect(new Set(data.posts.map((p) => p['slug'])).size).toBe(DATASET.posts);
    expect(data.posts.filter((p) => p['_status'] === 'draft')).toHaveLength(
      DATASET.posts / DATASET.draftEvery
    );
    for (const post of data.posts)
      expect(new Set(post['tags'] as string[]).size).toBe(DATASET.tagsPerPost);
  });

  it('loads into an on-disk libSQL database and serves it through the runtime', async () => {
    const fixture = await createFixture();
    try {
      expect(await fixture.runtime.count({ collection: 'posts', status: 'all' })).toBe(
        DATASET.posts
      );
      const first = await fixture.runtime.findByID({
        collection: 'posts',
        id: 'post-00001',
        depth: 1
      });
      expect((first['author'] as { id: string }).id).toMatch(/^author-/);
      expect(first['tags'] as unknown[]).toHaveLength(DATASET.tagsPerPost);
      expect((first['cover'] as { id: string }).id).toMatch(/^media-/);
    } finally {
      fixture.dispose();
    }
  }, 60_000);
});
