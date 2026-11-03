import { FORGE_PACKAGES, packageVersionLabel } from './forge-release';
import type { SiteMessageKey } from './i18n/i18n';

/**
 * What already works, grouped by what it gives you. Nothing here is planned work; every item is
 * implemented in released 1.0 (docs/STATE.md). Localization is deliberately worded as exactly
 * what exists: top-level `text` / `textarea` fields. The words are catalog keys (spec 101).
 */
export interface CapabilityGroup {
  id: 'content' | 'backend' | 'angular' | 'operations';
  title: SiteMessageKey;
  items: readonly SiteMessageKey[];
}

export const capabilityGroups: readonly CapabilityGroup[] = [
  {
    id: 'content',
    title: 'capabilities.content.title',
    items: [
      'capabilities.content.items.0',
      'capabilities.content.items.1',
      'capabilities.content.items.2',
      'capabilities.content.items.3',
      'capabilities.content.items.4',
      'capabilities.content.items.5'
    ]
  },
  {
    id: 'backend',
    title: 'capabilities.backend.title',
    items: [
      'capabilities.backend.items.0',
      'capabilities.backend.items.1',
      'capabilities.backend.items.2',
      'capabilities.backend.items.3',
      'capabilities.backend.items.4',
      'capabilities.backend.items.5'
    ]
  },
  {
    id: 'angular',
    title: 'capabilities.angular.title',
    items: [
      'capabilities.angular.items.0',
      'capabilities.angular.items.1',
      'capabilities.angular.items.2',
      'capabilities.angular.items.3',
      'capabilities.angular.items.4'
    ]
  },
  {
    id: 'operations',
    title: 'capabilities.operations.title',
    items: [
      'capabilities.operations.items.0',
      'capabilities.operations.items.1',
      'capabilities.operations.items.2',
      'capabilities.operations.items.3',
      'capabilities.operations.items.4',
      'capabilities.operations.items.5'
    ]
  }
];

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
  limits: 'localization.limits'
} as const satisfies { limits: SiteMessageKey } & Record<string, unknown>;

/** Only metrics the Analytics vertical really has (docs/analytics). No visitors, sessions or funnels. */
export const analyticsFacts = {
  ranges: ['24h', '7d', '30d', '90d'],
  privacy: [
    'analytics.privacy.0',
    'analytics.privacy.1',
    'analytics.privacy.2',
    'analytics.privacy.3',
    'analytics.privacy.4',
    'analytics.privacy.5'
  ]
} as const satisfies { ranges: readonly string[]; privacy: readonly SiteMessageKey[] };

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
