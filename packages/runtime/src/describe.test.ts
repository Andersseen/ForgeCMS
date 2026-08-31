import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { describeCollection } from './describe.js';

describe('describeCollection', () => {
  it('humanises the slug and derives a default description when admin metadata is absent', () => {
    const posts = defineCollection({
      slug: 'service_categories',
      fields: { title: defineField.text({ required: true }) }
    });

    const description = describeCollection(posts);

    expect(description.name).toBe('Service categories');
    expect(description.description).toBe('Content collection for service_categories');
    expect(description.useAsTitle).toBeUndefined();
    expect(description.defaultColumns).toBeUndefined();
  });

  it('prefers admin.label/description/useAsTitle/defaultColumns when set', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        title: defineField.text({ required: true }),
        excerpt: defineField.textarea()
      },
      admin: {
        label: 'Blog posts',
        description: 'Long-form articles',
        useAsTitle: 'title',
        defaultColumns: ['title', 'excerpt']
      }
    });

    const description = describeCollection(posts);

    expect(description.name).toBe('Blog posts');
    expect(description.description).toBe('Long-form articles');
    expect(description.useAsTitle).toBe('title');
    expect(description.defaultColumns).toEqual(['title', 'excerpt']);
  });

  it('omits defaultColumns when the array is empty', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text({ required: true }) },
      admin: { defaultColumns: [] }
    });

    expect(describeCollection(posts).defaultColumns).toBeUndefined();
  });
});
