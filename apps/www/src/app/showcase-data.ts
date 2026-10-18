import { FORGE_CHANNELS } from './forge-release';

/**
 * Content and pure state for the spec 097 homepage sections (story, bento, swap, Agent Kit terminal,
 * Analytics preview). Every snippet uses the real 1.0 API names; every number is illustrative and
 * labelled as such on the page. Kept out of the components so it can be tested without a browser.
 */

export type StoryStageId = 'schema' | 'runtime' | 'angular' | 'admin' | 'deploy';

export interface StoryStage {
  id: StoryStageId;
  index: string;
  label: string;
  kicker: string;
  title: string;
  body: string;
}

export const storyStages: readonly StoryStage[] = [
  {
    id: 'schema',
    index: '01',
    label: 'Schema',
    kicker: 'TypeScript-first',
    title: 'Model the content once, in code.',
    body: 'A collection is plain TypeScript in your repository: fields, drafts, locales and access rules, reviewed like any other change.'
  },
  {
    id: 'runtime',
    index: '02',
    label: 'Runtime',
    kicker: 'Local API + REST',
    title: 'One pipeline for every read and write.',
    body: 'Server code calls the Local API with no HTTP hop; browsers use REST. Both run the same access, hooks, drafts and validation.'
  },
  {
    id: 'angular',
    index: '03',
    label: 'Angular',
    kicker: 'Typed client + SSR',
    title: 'Your components read typed signals.',
    body: 'The Angular client turns a collection into a signal resource typed from your schema, rendered on the server with Analog and hydrated.'
  },
  {
    id: 'admin',
    index: '04',
    label: 'Admin',
    kicker: 'Give editors control',
    title: 'Your client gets a real editor.',
    body: 'The reusable Angular admin mounts under your own routes: content, drafts, media, users and both languages, with nothing to hand-build.'
  },
  {
    id: 'deploy',
    index: '05',
    label: 'Deploy',
    kicker: 'Certified profiles',
    title: 'Ship it where it fits.',
    body: 'Cloudflare Pages with D1 and R2, or any Node host with libSQL and S3-compatible storage. Both profiles are certified from packed artifacts.'
  }
];

/**
 * The stage the reader is on: the last stage whose top has crossed the reading line. `tops` are the
 * stages' viewport-relative tops (in DOM order), `line` the reading line (half the viewport height).
 * Before the first stage reaches the line the first is active; it never returns -1.
 */
export function activeStageIndex(tops: readonly number[], line: number): number {
  let active = 0;
  tops.forEach((top, index) => {
    if (top <= line) active = index;
  });
  return active;
}

export const storySnippets = {
  schema: `export const services = defineCollection({
  slug: 'services',
  drafts: true,
  locales: ['es', 'en'],
  fields: {
    title: defineField.text({ required: true, localized: true }),
    summary: defineField.textarea({ localized: true }),
    image: defineField.upload({ collection: 'media' })
  }
});`,
  localApi: `// Analog server route: no HTTP hop, visitor access rules
const { docs } = await runtime.find({
  collection: 'services',
  locale: 'es',
  overrideAccess: false,
  user: null
});`,
  rest: `GET /api/v1/services?locale=es`,
  angular: `@Component({
  template: \`@for (s of services.value()?.docs; track s.id) {
    <app-service-card [service]="s" />
  }\`
})
export class ServicesPage {
  services = collectionResource<Schema>(() => ({
    collection: 'services', locale: 'es'
  }));
}`
} as const;

/** The runtime pipeline every Local API and REST call runs through (stage 02). */
export const runtimePipeline = ['Access', 'Hooks', 'Drafts', 'Validation'] as const;

/** Stage 05: the two certified deployment profiles. */
export const deployProfiles = [
  { name: 'Cloudflare', host: 'Pages', database: 'D1', storage: 'R2' },
  { name: 'Portable', host: 'Any Node host', database: 'libSQL', storage: 'S3-compatible' }
] as const;

/** Stage 04 and the swap section: a believable slice of the Forge admin. */
export const adminRows = [
  { title: 'Facial treatments', status: 'Published' },
  { title: 'Laser hair removal', status: 'Published' },
  { title: 'Skin consultation', status: 'Draft' }
] as const;

/** The four homepage arguments, in bento order (spans are set in the template). */
export const bentoCards = {
  angular: {
    title: 'Angular native',
    body: 'Built for Angular and Analog, typed from your schema to your template, server-rendered and hydrated.',
    points: ['Angular + Analog', 'Typed end to end', 'SSR + hydration']
  },
  client: {
    title: 'Client ready',
    body: 'A reusable admin your client can actually use, mounted inside your app.',
    points: [
      'Drafts and publishing',
      'Media library',
      'ES / EN content',
      'Users and roles',
      'Analytics'
    ]
  },
  deploy: {
    title: 'Deploy your way',
    body: 'Edge-native on Cloudflare, or portable anywhere Node runs.',
    points: ['Cloudflare D1 + R2', 'Portable libSQL + S3']
  },
  agent: {
    title: 'Agent ready',
    body: 'Optional developer tooling so coding agents follow the supported Forge patterns.',
    points: ['Read-only MCP', 'Eight official skills', 'Version-matched docs', 'One-command init']
  }
} as const;

export type SwapStateId = 'model' | 'build' | 'publish';

export interface SwapState {
  id: SwapStateId;
  tab: string;
  /** Which side leads: the developer's work, or the client's action. */
  lead: 'developer' | 'client';
  caption: string;
}

export const swapStates: readonly SwapState[] = [
  {
    id: 'model',
    tab: 'Model',
    lead: 'developer',
    caption: 'You declare the fields once. Forge renders the form your client edits.'
  },
  {
    id: 'build',
    tab: 'Build',
    lead: 'developer',
    caption: 'Your components own the layout. The admin owns the content behind them.'
  },
  {
    id: 'publish',
    tab: 'Publish',
    lead: 'client',
    caption: 'The client publishes a draft. Your site renders it through the typed client.'
  }
];

export const swapSnippets = {
  model: `defineCollection({
  slug: 'services',
  locales: ['es', 'en'],
  fields: {
    title: defineField.text({ localized: true }),
    summary: defineField.textarea({ localized: true }),
    image: defineField.upload({ collection: 'media' })
  }
})`,
  build: `<app-header />
<app-services
  [items]="services.value()?.docs" />
<app-contact />`,
  publish: `services = collectionResource<Schema>(() => ({
  collection: 'services',
  locale: 'en'
}));
// drafts stay private: only published
// documents reach anonymous visitors`
} as const;

export const developerRole = [
  'Builds the Angular UI',
  'Defines the Forge schema',
  'Owns every component',
  'Deploys the app'
] as const;

export const clientRole = [
  'Opens Forge Admin',
  'Edits titles and descriptions',
  'Writes ES and EN content',
  'Uploads media and publishes',
  'Sees Analytics'
] as const;

/** The Agent Kit terminal (spec 096 `forge-cms-agent init`), as staged rows. */
export interface TerminalRow {
  kind: 'command' | 'ok' | 'note' | 'prompt' | 'tool' | 'result';
  text: string;
  detail?: string;
}

export const agentTerminal: readonly TerminalRow[] = [
  { kind: 'command', text: 'pnpm exec forge-cms-agent init' },
  { kind: 'ok', text: 'MCP configured', detail: '.mcp.json · forge-cms (read-only)' },
  { kind: 'ok', text: '8 ForgeCMS skills installed', detail: '.claude/skills/' },
  { kind: 'ok', text: 'Version-matched docs ready', detail: 'bundled, offline' },
  { kind: 'ok', text: 'Project doctor available', detail: 'forge_project_doctor' },
  { kind: 'prompt', text: 'Make Services editable in Spanish and English.' },
  {
    kind: 'tool',
    text: 'forge_project_detect',
    detail: 'Analog · Cloudflare profile · no locales yet'
  },
  { kind: 'tool', text: 'forge_docs_search', detail: '"localization" in the installed version' },
  { kind: 'tool', text: 'forgecms-localization', detail: 'skill: the supported pattern' },
  {
    kind: 'result',
    text: 'Supported Forge implementation',
    detail: 'written by your agent with its own tools, reviewed by you'
  }
];

export const agentRoles = [
  { name: 'MCP', role: 'Read-only project knowledge' },
  { name: 'Skills', role: 'Procedural Forge guidance' },
  { name: 'Your agent', role: 'Edits code with its normal tools' }
] as const;

/** What the Agent Kit section says about availability. Derived from registry truth only. */
export function agentAvailabilityNote(): string {
  return FORGE_CHANNELS.agentPublished
    ? 'Published at 1.0.0; the Agent Kit remains experimental.'
    : 'Candidate workflow: @forge-cms/agent is not on npm yet.';
}

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

export interface AnalyticsPreview {
  range: AnalyticsRange;
  pageviews: number;
  /** Change vs the previous period of the same length, in percent. */
  change: number;
  /** Relative bar heights (0–1) for the timeline. */
  timeline: readonly number[];
  topPages: readonly { path: string; share: number }[];
  referrers: readonly { host: string; share: number }[];
  countries: readonly { code: string; share: number }[];
}

/**
 * Deterministic, illustrative numbers for the preview. Never live data: the page labels them, and the
 * shape only covers metrics the Analytics vertical really has (docs/analytics).
 */
export const analyticsPreview: Record<AnalyticsRange, AnalyticsPreview> = {
  '24h': {
    range: '24h',
    pageviews: 212,
    change: 6.1,
    timeline: [0.2, 0.15, 0.1, 0.12, 0.3, 0.55, 0.7, 0.62, 0.8, 0.74, 0.9, 0.66],
    topPages: [
      { path: '/', share: 0.46 },
      { path: '/services', share: 0.31 },
      { path: '/contact', share: 0.12 }
    ],
    referrers: [
      { host: 'google.com', share: 0.52 },
      { host: 'instagram.com', share: 0.21 }
    ],
    countries: [
      { code: 'ES', share: 0.68 },
      { code: 'GB', share: 0.14 },
      { code: 'DE', share: 0.08 }
    ]
  },
  '7d': {
    range: '7d',
    pageviews: 1284,
    change: 18.4,
    timeline: [0.48, 0.62, 0.55, 0.7, 0.82, 0.66, 0.92],
    topPages: [
      { path: '/', share: 0.41 },
      { path: '/services', share: 0.34 },
      { path: '/contact', share: 0.11 }
    ],
    referrers: [
      { host: 'google.com', share: 0.49 },
      { host: 'instagram.com', share: 0.24 }
    ],
    countries: [
      { code: 'ES', share: 0.64 },
      { code: 'GB', share: 0.15 },
      { code: 'DE', share: 0.09 }
    ]
  },
  '30d': {
    range: '30d',
    pageviews: 5310,
    change: 9.7,
    timeline: [0.5, 0.58, 0.64, 0.6, 0.72, 0.68, 0.8, 0.77, 0.86, 0.9],
    topPages: [
      { path: '/', share: 0.39 },
      { path: '/services', share: 0.35 },
      { path: '/contact', share: 0.12 }
    ],
    referrers: [
      { host: 'google.com', share: 0.51 },
      { host: 'instagram.com', share: 0.2 }
    ],
    countries: [
      { code: 'ES', share: 0.61 },
      { code: 'GB', share: 0.17 },
      { code: 'DE', share: 0.1 }
    ]
  },
  '90d': {
    range: '90d',
    pageviews: 14872,
    change: -3.2,
    timeline: [0.82, 0.76, 0.7, 0.74, 0.66, 0.62, 0.68, 0.72, 0.7, 0.64, 0.69, 0.75],
    topPages: [
      { path: '/', share: 0.42 },
      { path: '/services', share: 0.33 },
      { path: '/contact', share: 0.13 }
    ],
    referrers: [
      { host: 'google.com', share: 0.55 },
      { host: 'instagram.com', share: 0.18 }
    ],
    countries: [
      { code: 'ES', share: 0.6 },
      { code: 'GB', share: 0.18 },
      { code: 'DE', share: 0.1 }
    ]
  }
};

export const analyticsRanges: readonly AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

/** "+18.4%" / "−3.2%" — the comparison label the preview shows next to pageviews. */
export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '−';
  return `${sign}${Math.abs(change).toFixed(1)}%`;
}
