import { FORGE_CHANNELS } from './forge-release';
import type { SiteMessageKey, SiteText } from './i18n/i18n';

/**
 * Content and pure state for the spec 097 homepage sections (story, bento, swap, Agent Kit terminal,
 * Analytics preview). Every snippet uses the real 1.0 API names; every number is illustrative and
 * labelled as such on the page. Kept out of the components so it can be tested without a browser.
 *
 * Visible copy is a catalog key (spec 101) — the words live in Glossa, typed by `SiteMessageKey`.
 * Code, commands, file paths and product names are not translated, so they stay literal here.
 */

export type StoryStageId = 'schema' | 'runtime' | 'angular' | 'admin' | 'deploy';

export interface StoryStage {
  id: StoryStageId;
  index: string;
  label: SiteMessageKey;
  kicker: SiteMessageKey;
  title: SiteMessageKey;
  body: SiteMessageKey;
}

const stage = <const Id extends StoryStageId>(id: Id, index: string) =>
  ({
    id,
    index,
    label: `story.${id}.label`,
    kicker: `story.${id}.kicker`,
    title: `story.${id}.title`,
    body: `story.${id}.body`
  }) as const satisfies StoryStage;

export const storyStages: readonly StoryStage[] = [
  stage('schema', '01'),
  stage('runtime', '02'),
  stage('angular', '03'),
  stage('admin', '04'),
  stage('deploy', '05')
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
export const runtimePipeline = [
  'story.pipeline.0',
  'story.pipeline.1',
  'story.pipeline.2',
  'story.pipeline.3'
] as const satisfies readonly SiteMessageKey[];

export interface DeployProfile {
  id: 'cloudflare' | 'portable';
  name: SiteText;
  host: SiteText;
  database: SiteText;
  storage: SiteText;
}

/** Stage 05: the two certified deployment profiles. */
export const deployProfiles: readonly DeployProfile[] = [
  {
    id: 'cloudflare',
    name: { literal: 'Cloudflare' },
    host: { literal: 'Pages' },
    database: { literal: 'D1' },
    storage: { literal: 'R2' }
  },
  {
    id: 'portable',
    name: { key: 'story.portable' },
    host: { key: 'story.anyNodeHost' },
    database: { literal: 'libSQL' },
    storage: { key: 'story.s3Compatible' }
  }
];

/** Stage 04 and the swap section: a believable slice of the Forge admin. */
export const adminRows = [
  { title: 'sample.facial', status: 'published' },
  { title: 'sample.laser', status: 'published' },
  { title: 'sample.consultation', status: 'draft' }
] as const satisfies readonly { title: SiteMessageKey; status: 'published' | 'draft' }[];

/** The four homepage arguments, in bento order (spans are set in the template). */
export const bentoCards = {
  angular: {
    title: 'bento.angular.title',
    body: 'bento.angular.body',
    points: ['bento.angular.points.0', 'bento.angular.points.1', 'bento.angular.points.2']
  },
  client: {
    title: 'bento.client.title',
    body: 'bento.client.body',
    points: [
      { id: 'drafts', label: 'bento.client.points.drafts' },
      { id: 'media', label: 'bento.client.points.media' },
      { id: 'locales', label: 'bento.client.points.locales' },
      { id: 'users', label: 'bento.client.points.users' },
      { id: 'analytics', label: 'bento.client.points.analytics' }
    ]
  },
  deploy: {
    title: 'bento.deploy.title',
    body: 'bento.deploy.body',
    points: ['bento.deploy.points.0', 'bento.deploy.points.1']
  },
  agent: {
    title: 'bento.agent.title',
    body: 'bento.agent.body',
    points: [
      'bento.agent.points.0',
      'bento.agent.points.1',
      'bento.agent.points.2',
      'bento.agent.points.3'
    ]
  }
} as const satisfies Record<
  string,
  {
    title: SiteMessageKey;
    body: SiteMessageKey;
    points: readonly (SiteMessageKey | { id: string; label: SiteMessageKey })[];
  }
>;

export type SwapStateId = 'model' | 'build' | 'publish';

export interface SwapState {
  id: SwapStateId;
  tab: SiteMessageKey;
  /** Which side leads: the developer's work, or the client's action. */
  lead: 'developer' | 'client';
  caption: SiteMessageKey;
  developer: SiteMessageKey;
  client: SiteMessageKey;
}

const swapState = <const Id extends SwapStateId>(id: Id, lead: SwapState['lead']) =>
  ({
    id,
    tab: `flow.${id}.tab`,
    lead,
    caption: `flow.${id}.caption`,
    developer: `flow.${id}.developer`,
    client: `flow.${id}.client`
  }) as const satisfies SwapState;

export const swapStates: readonly SwapState[] = [
  swapState('model', 'developer'),
  swapState('build', 'developer'),
  swapState('publish', 'client')
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
  'flow.developerRole.0',
  'flow.developerRole.1',
  'flow.developerRole.2',
  'flow.developerRole.3'
] as const satisfies readonly SiteMessageKey[];

export const clientRole = [
  { id: 'opens', label: 'flow.clientRole.opens' },
  { id: 'edits', label: 'flow.clientRole.edits' },
  { id: 'writes', label: 'flow.clientRole.writes' },
  { id: 'uploads', label: 'flow.clientRole.uploads' },
  { id: 'analytics', label: 'flow.clientRole.analytics' }
] as const satisfies readonly { id: string; label: SiteMessageKey }[];

/** The Agent Kit terminal (spec 096 `forge-cms-agent init`), as staged rows. */
export interface TerminalRow {
  kind: 'command' | 'ok' | 'note' | 'prompt' | 'tool' | 'result';
  text: SiteText;
  detail?: SiteText;
}

export const agentTerminal: readonly TerminalRow[] = [
  { kind: 'command', text: { literal: 'pnpm exec forge-cms-agent init' } },
  {
    kind: 'ok',
    text: { key: 'agentKit.terminal.mcp' },
    detail: { key: 'agentKit.terminal.mcpDetail' }
  },
  { kind: 'ok', text: { key: 'agentKit.terminal.skills' }, detail: { literal: '.claude/skills/' } },
  {
    kind: 'ok',
    text: { key: 'agentKit.terminal.docs' },
    detail: { key: 'agentKit.terminal.docsDetail' }
  },
  {
    kind: 'ok',
    text: { key: 'agentKit.terminal.doctor' },
    detail: { literal: 'forge_project_doctor' }
  },
  { kind: 'prompt', text: { key: 'agentKit.terminal.prompt' } },
  {
    kind: 'tool',
    text: { literal: 'forge_project_detect' },
    detail: { key: 'agentKit.terminal.detect' }
  },
  {
    kind: 'tool',
    text: { literal: 'forge_docs_search' },
    detail: { key: 'agentKit.terminal.search' }
  },
  {
    kind: 'tool',
    text: { literal: 'forgecms-localization' },
    detail: { key: 'agentKit.terminal.skill' }
  },
  {
    kind: 'result',
    text: { key: 'agentKit.terminal.result' },
    detail: { key: 'agentKit.terminal.resultDetail' }
  }
];

export const agentRoles = [
  { name: { literal: 'MCP' }, role: 'agentKit.roles.mcp' },
  { name: { key: 'agentKit.skills' }, role: 'agentKit.roles.skills' },
  { name: { key: 'agentKit.roles.agent' }, role: 'agentKit.roles.agentRole' }
] as const satisfies readonly { name: SiteText; role: SiteMessageKey }[];

/** What the Agent Kit section says about availability. Derived from registry truth only. */
export function agentAvailabilityNote(): 'agentKit.published' | 'agentKit.candidate' {
  return FORGE_CHANNELS.agentPublished ? 'agentKit.published' : 'agentKit.candidate';
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

/**
 * "+18.4%" / "−3.2%" — the comparison label the preview shows next to pageviews. Spanish and
 * Ukrainian write a decimal comma and a (non-breaking) space before the percent sign.
 */
export function formatChange(change: number, locale = 'en'): string {
  const sign = change >= 0 ? '+' : '−';
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(Math.abs(change));
  const space = locale === 'en' ? '' : '\u00a0';
  return `${sign}${value}${space}%`;
}
