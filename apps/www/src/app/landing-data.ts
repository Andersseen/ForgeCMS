import { CURRENT_FORGE_VERSION, FORGE_PACKAGES } from './forge-release';

/**
 * What already works, in the order a first-time visitor cares about. Nothing here is planned work;
 * all capability copy describes released work rather than pending releases.
 */
export const features = [
  {
    title: 'TypeScript-first schema',
    description:
      'Collections, globals and fields are code. One definition drives validation, the database, the admin form and inferred Local API types.'
  },
  {
    title: 'Local API, no internal HTTP',
    description:
      'Server code calls runtime.find/findOne/create/update/delete directly, with access control, hooks, drafts and relation population applied.'
  },
  {
    title: 'Angular-native client and admin',
    description:
      'A typed client with signal resources, a cookie session and route guard, and an admin you mount under your own routes.'
  },
  {
    title: 'Access, hooks, drafts, versions',
    description:
      'Access rules are functions that can return query constraints. The hook pipeline runs on every write. Drafts, versions and live preview are built in.'
  },
  {
    title: 'Relations, localization, globals',
    description:
      'Relations are populated by depth and delete rules keep them intact. Localized fields and singleton globals share the same field DSL. Blocks, arrays and groups compose pages.'
  },
  {
    title: 'Cloudflare D1/R2, portable libSQL',
    description:
      'D1 and R2 are the first-class deployment. libSQL runs the same adapter contract off Cloudflare. Both are proven by real consumer apps.'
  },
  {
    title: 'Schema-drift safety',
    description:
      'Schema sync plans before it writes. It applies safe additive changes and refuses drift that needs a migration. Reviewed migrations run once, atomically, with a durable history.'
  },
  {
    title: 'Real consumer fixtures',
    description:
      'A clinic site built on the CMS and a tiny external-style project exercise the published packages end to end, including a Strata controller integration.'
  }
] as const;

export const packages = FORGE_PACKAGES.map((pkg) => ({ ...pkg, version: CURRENT_FORGE_VERSION }));

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

/** The Local API in the shape a server route uses it. */
export const localApiCode = `// An Analog server route: no HTTP hop, same access rules as a visitor.
const post = await runtime.findOne({
  collection: 'posts',
  where: { slug },
  depth: 1,
  overrideAccess: false,
  user: null
});`;

export type MilestoneStatus = 'complete' | 'in-progress' | 'next' | 'pending' | 'planned';

export interface RoadmapMilestone {
  version: string;
  title: string;
  status: MilestoneStatus;
  steps?: { title: string; status: MilestoneStatus }[];
}

/**
 * Product checkpoints from docs/ROADMAP.md. These are not npm versions: the published family is
 * {@link CURRENT_FORGE_VERSION}.
 */
export const ROADMAP_MILESTONES: readonly RoadmapMilestone[] = [
  { version: '0.6', title: 'Auth and data integrity', status: 'complete' },
  {
    version: '0.7',
    title: 'Upgrade safety',
    status: 'complete',
    steps: [
      { title: 'Schema drift detection', status: 'complete' },
      { title: 'Reviewed migrations', status: 'complete' },
      { title: 'Upgrade and backup/restore rehearsal', status: 'complete' }
    ]
  },
  {
    version: '0.8',
    title: 'Angular client and DX',
    status: 'complete',
    steps: [
      { title: 'Configurable transport and structured errors', status: 'complete' },
      { title: 'Honest schema-to-wire types', status: 'complete' },
      { title: 'Resource reliability and peer compatibility', status: 'complete' }
    ]
  },
  { version: '0.9', title: 'SSR for Analog', status: 'complete' },
  { version: '0.10', title: 'Portable storage and deployment profiles', status: 'complete' },
  { version: '0.11', title: 'Admin certification', status: 'complete' },
  { version: '0.12', title: 'Release-candidate preparation', status: 'next' }
];

/** Static, illustrative content shared by the three product showcase views. */
export const showcasePost = {
  id: 'post_angular',
  title: 'A home for your next idea',
  slug: 'a-home-for-your-next-idea',
  author: 'user_editor',
  _status: 'published'
} as const;

export const showcaseResponse = JSON.stringify({ data: showcasePost }, null, 2);
