import { FORGE_PACKAGES, packageVersionLabel } from './forge-release';

/**
 * What already works, grouped by what it gives you. Nothing here is planned work; every item is
 * implemented in released 1.0 (docs/STATE.md). Localization is deliberately worded as exactly
 * what exists: top-level `text` / `textarea` fields.
 */
export interface CapabilityGroup {
  id: 'content' | 'backend' | 'angular' | 'operations';
  title: string;
  summary: string;
  items: readonly string[];
}

export const capabilityGroups: readonly CapabilityGroup[] = [
  {
    id: 'content',
    title: 'Content',
    summary: 'One TypeScript schema drives validation, storage and the admin form.',
    items: [
      'Collections and singleton globals',
      'Blocks, arrays and groups for composed pages',
      'Drafts, versions and live preview',
      'Relations populated by depth',
      'Localization of text fields',
      'Uploads to R2 or S3'
    ]
  },
  {
    id: 'backend',
    title: 'Backend',
    summary: 'Business rules live in the runtime, not in a route handler.',
    items: [
      'Local API with no internal HTTP hop',
      'REST with a stable response envelope',
      'Hooks on every write',
      'Row- and field-level access functions',
      'Browser sessions with CSRF',
      'API keys for machine clients'
    ]
  },
  {
    id: 'angular',
    title: 'Angular',
    summary: 'Built for Angular and Analog, not adapted to them.',
    items: [
      'Typed client generated from your schema',
      'Signal resources',
      'SSR and hydration for Analog',
      'A reusable admin you mount under your own routes',
      'Custom admin navigation and mount path'
    ]
  },
  {
    id: 'operations',
    title: 'Operations',
    summary: 'The part most CMSs leave to you: changing a live site safely.',
    items: [
      'Schema drift detection before any write',
      'Reviewed, atomic migrations',
      'Backup and restore rehearsal',
      'Cloudflare D1 + R2, first class',
      'Portable libSQL + S3',
      'Packed-artifact certification'
    ]
  }
];

export const experimentalBadgeLabel = 'Experimental';
export const experimentalNote = 'Useful today. Compatibility may evolve.';

/** Illustrative localization example. Same shape as the `notices` collection in the Lumea demo. */
export const localizationExample = {
  schema: `export const notices = defineCollection({
  slug: 'notices',
  locales: ['es', 'en'],
  fields: {
    title: defineField.text({ localized: true }),
    message: defineField.textarea({ localized: true }),
    slug: defineField.slug({ sourceField: 'title' })
  }
});`,
  locales: [
    {
      code: 'ES',
      title: 'Tratamientos faciales',
      description: 'Cuidado de la piel con resultados naturales.'
    },
    {
      code: 'EN',
      title: 'Facial treatments',
      description: 'Skin care with natural-looking results.'
    }
  ],
  points: [
    'Locales are declared in the schema.',
    'Top-level text and textarea fields are editable per locale.',
    'Editors switch locale in the admin; each language keeps its own value.',
    'Slugs, numbers, relations and uploads stay shared.'
  ],
  limits: 'Rich text, blocks, arrays, uploads and relations are not localized in 1.0.'
} as const;

/** Only metrics the Analytics vertical really has (docs/analytics). No visitors, sessions or funnels. */
export const analyticsFacts = {
  metrics: [
    'Pageviews',
    'Change vs previous period',
    'Timeline',
    'Top pages',
    'Referrers',
    'Countries'
  ],
  ranges: ['24h', '7d', '30d', '90d'],
  privacy: [
    'No visitor id',
    'No persistent tracking cookie',
    'No IP stored by Forge',
    'No email or user id',
    'No query string or hash',
    'Referrer host only'
  ]
} as const;

export const packages = FORGE_PACKAGES.map((pkg) => ({
  ...pkg,
  version: packageVersionLabel(pkg)
}));

export const installCommand =
  'pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/db @forge-cms/auth @forge-cms/storage';

export const exampleCode = `import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    author: defineField.relation({ collection: 'users' })
  }
});`;

/** Static, illustrative content shared by the three product showcase views. */
export const showcasePost = {
  id: 'post_angular',
  title: 'A home for your next idea',
  slug: 'a-home-for-your-next-idea',
  author: 'user_editor',
  _status: 'published'
} as const;

export const showcaseResponse = JSON.stringify({ data: showcasePost }, null, 2);
