import { defineEventHandler } from 'h3';
import type { SelectFieldOptions } from '@forge-cms/core';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  const collections = serverRuntime.getCollections().map((c) => ({
    slug: c.slug,
    name: c.slug.charAt(0).toUpperCase() + c.slug.slice(1),
    description: `Content collection for ${c.slug}`,
    fieldDefinitions: Object.entries(c.fields).map(([name, field]) => ({
      name,
      kind: field.kind,
      label: field.options.label ?? name,
      required: field.options.required ?? false,
      ...(field.kind === 'select' && {
        options: (field.options as SelectFieldOptions).options
      }),
      ...(field.kind === 'relation' && {
        relation: {
          collection: (field.options as { collection: string }).collection,
          many: (field.options as { many?: boolean }).many ?? false
        }
      })
    }))
  }));

  return { data: collections };
});
