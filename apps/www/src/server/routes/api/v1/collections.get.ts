import { defineEventHandler } from 'h3';
import type { SelectFieldOptions } from '@forge-cms/core';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async () => {
  const serverRuntime = await getServerRuntime();
  const collections = serverRuntime.getCollections().map((c) => ({
    slug: c.slug,
    name: c.slug.charAt(0).toUpperCase() + c.slug.slice(1),
    description: `Content collection for ${c.slug}`,
    fields: Object.keys(c.fields),
    fieldDefinitions: Object.entries(c.fields).map(([name, field]) => ({
      name,
      kind: field.kind,
      label: field.options.label ?? name,
      required: field.options.required ?? false,
      ...(field.kind === 'select' && {
        options: (field.options as SelectFieldOptions).options
      })
    }))
  }));

  return { data: collections };
});
