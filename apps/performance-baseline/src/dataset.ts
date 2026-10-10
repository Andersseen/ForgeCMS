import { defineCollection, defineField } from '@forge-cms/core';

/**
 * The fixed performance dataset (spec 089). Everything about it is a constant or derived from a seeded
 * PRNG, so two runs on two machines load byte-identical content (ids are positional, never random).
 *
 * Sizes were chosen after reading the algorithms (spec 089 §Performance fixture): large enough that an
 * N+1 per row, an accidental full-table scan or a per-row loop would be visible in database-call counts
 * and in timings (2,000 posts, pages up to the 500-row hard maximum, 100 relation targets per field), small
 * enough to load in a couple of seconds and measure in well under a minute.
 */
export const FIXTURE_VERSION = 'r02-1';

export const DATASET = {
  /** Seed for every pseudo-random choice (mulberry32). */
  seed: 0x0f0f6e,
  authors: 50,
  tags: 100,
  media: 200,
  posts: 2_000,
  /** Relations per post: 1 author, this many tags (many-relation), 1 cover (upload relation). */
  tagsPerPost: 3,
  categories: ['news', 'guides', 'releases', 'opinion', 'changelog', 'dev', 'ops', 'community'],
  /** Every n-th post is a draft; the rest are published. */
  draftEvery: 10
} as const;

/** mulberry32 — tiny, well-known, fully deterministic. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const id = (kind: string, index: number): string =>
  `${kind}-${String(index).padStart(5, '0')}`;

export const authors = defineCollection({
  slug: 'authors',
  access: { read: () => true },
  fields: {
    name: defineField.text({ required: true }),
    bio: defineField.textarea()
  }
});

export const tags = defineCollection({
  slug: 'tags',
  access: { read: () => true },
  fields: { label: defineField.text({ required: true }) }
});

export const media = defineCollection({
  slug: 'media',
  upload: true,
  access: { read: () => true, create: () => true, delete: () => true },
  fields: {
    filename: defineField.text(),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text()
  }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title' },
  indexes: [{ fields: ['category'] }, { fields: ['rank'] }],
  access: { read: () => true, create: () => true, update: () => true, delete: () => true },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true }),
    category: defineField.select({ options: [...DATASET.categories] }),
    rank: defineField.number(),
    views: defineField.number(),
    featured: defineField.boolean(),
    body: defineField.textarea(),
    author: defineField.relation({ collection: 'authors' }),
    tags: defineField.relation({ collection: 'tags', many: true }),
    cover: defineField.upload({ collection: 'media' })
  }
});

export const COLLECTIONS = [authors, tags, media, posts];

type Row = Record<string, unknown>;

/** Every document of the dataset, in insertion order. Pure function of the seed. */
export function generateDataset(): { authors: Row[]; tags: Row[]; media: Row[]; posts: Row[] } {
  const random = createRandom(DATASET.seed);
  const pick = (n: number) => Math.floor(random() * n);

  const authorRows = Array.from({ length: DATASET.authors }, (_, i) => ({
    id: id('author', i),
    name: `Author ${i}`,
    bio: `Writes about topic ${pick(40)}.`
  }));
  const tagRows = Array.from({ length: DATASET.tags }, (_, i) => ({
    id: id('tag', i),
    label: `tag-${i}`
  }));
  const mediaRows = Array.from({ length: DATASET.media }, (_, i) => ({
    id: id('media', i),
    filename: `image-${i}.png`,
    url: `/api/media/media/image-${i}.png`,
    contentType: 'image/png',
    filesize: 2_048 + i,
    alt: `Image ${i}`,
    _storageKey: `media/image-${i}.png`
  }));

  // `rank` is a permutation of 0..posts-1 (unique, so sorts are total orders and pages are stable).
  const ranks = Array.from({ length: DATASET.posts }, (_, i) => i);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [ranks[i], ranks[j]] = [ranks[j]!, ranks[i]!];
  }

  const postRows = Array.from({ length: DATASET.posts }, (_, i) => {
    const tagIds = new Set<string>();
    while (tagIds.size < DATASET.tagsPerPost) tagIds.add(id('tag', pick(DATASET.tags)));
    return {
      id: id('post', i),
      title: `Post ${i}: ${DATASET.categories[i % DATASET.categories.length]} update`,
      slug: `post-${i}`,
      category: DATASET.categories[pick(DATASET.categories.length)],
      rank: ranks[i],
      views: pick(1_000),
      featured: random() < 0.25,
      body: `Body of post ${i}. `.repeat(8 + pick(8)).trim(),
      author: id('author', pick(DATASET.authors)),
      tags: [...tagIds],
      cover: id('media', pick(DATASET.media)),
      _status: i % DATASET.draftEvery === 0 ? 'draft' : 'published'
    };
  });

  return { authors: authorRows, tags: tagRows, media: mediaRows, posts: postRows };
}
