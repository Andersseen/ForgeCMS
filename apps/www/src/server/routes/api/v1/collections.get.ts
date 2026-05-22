import { defineEventHandler } from 'h3';
import { serverRuntime } from '../../../api/runtime';

export default defineEventHandler(() => {
  const collections = serverRuntime.getCollections().map((c) => ({
    slug: c.slug,
    name: c.slug.charAt(0).toUpperCase() + c.slug.slice(1),
    description: `Content collection for ${c.slug}`,
    fields: Object.keys(c.fields)
  }));

  return { data: collections };
});
