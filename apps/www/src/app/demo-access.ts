import type { SiteMessageKey, SiteText } from './i18n/i18n';

/**
 * Where the "try it" dialog sends people, and what it tells them.
 *
 * The realistic demo (`apps/demo-aesthetics`) is a separate app: a clinic's public site plus the CMS
 * that runs it. It is the honest answer to "what is this CMS like?", because it is content a real
 * business would have rather than a table of example rows.
 */

/**
 * The deployed demo. CI publishes `apps/demo-aesthetics` to its own Cloudflare Pages project on
 * every push to main (`deploy-demo` in .github/workflows/ci.yml), so this is a plain link — trying
 * the CMS must never require cloning anything.
 */
export const DEMO_APP_URL = 'https://forge-cms-demo.pages.dev';

/** The demo's admin, so the dialog can send an editor straight to the login screen. */
export const DEMO_ADMIN_URL = `${DEMO_APP_URL}/login`;

/** The demo's source, for developers who want the code rather than the running site. */
export const DEMO_SOURCE_URL =
  'https://github.com/Andersseen/ForgeCMS/tree/main/apps/demo-aesthetics';

export const DEMO_CREDENTIALS = [
  { role: 'demo.roles.admin', email: 'demo@lumea.clinic', password: 'lumea-demo' },
  { role: 'demo.roles.frontDesk', email: 'frontdesk@lumea.clinic', password: 'lumea-desk' }
] as const satisfies readonly { role: SiteMessageKey; email: string; password: string }[];

/** A journey step; the words are catalog keys (spec 101). */
export interface DemoStep {
  title: SiteMessageKey;
  detail: SiteMessageKey;
}

const editorStep = (id: 'site' | 'browse' | 'locales' | 'booking' | 'limits' | 'traffic') =>
  ({
    title: `demo.editorSteps.${id}.title`,
    detail: `demo.editorSteps.${id}.detail`
  }) as const satisfies DemoStep;

const developerStep = (
  id: 'model' | 'localApi' | 'localization' | 'writes' | 'admin' | 'dogfood' | 'tests'
) =>
  ({
    title: `demo.developerSteps.${id}.title`,
    detail: `demo.developerSteps.${id}.detail`
  }) as const satisfies DemoStep;

/** For someone who will only ever use the UI — the person a CMS is actually for. */
export const EDITOR_STEPS: DemoStep[] = [
  editorStep('site'),
  editorStep('browse'),
  editorStep('locales'),
  editorStep('booking'),
  editorStep('limits'),
  editorStep('traffic')
];

/** For an Angular developer deciding whether this is worth adopting. */
export const DEVELOPER_STEPS: DemoStep[] = [
  developerStep('model'),
  developerStep('localApi'),
  developerStep('localization'),
  developerStep('writes'),
  developerStep('admin'),
  developerStep('dogfood'),
  developerStep('tests')
];

/**
 * "What to explore": one line per capability the live demo really exercises. `where` names a demo
 * admin screen or a source file, which the demo itself shows in English, so it stays literal unless
 * it is an instruction.
 */
export interface DemoExploreItem {
  label: SiteMessageKey;
  where: SiteText;
  experimental?: boolean;
}

export const DEMO_EXPLORE: { audience: SiteMessageKey; items: DemoExploreItem[] }[] = [
  {
    audience: 'demo.explore.editor.audience',
    items: [
      { label: 'demo.explore.editor.publish', where: { literal: 'Admin → Treatments' } },
      { label: 'demo.explore.editor.media', where: { literal: 'Admin → Media' } },
      { label: 'demo.explore.editor.roles', where: { key: 'demo.explore.editor.rolesWhere' } },
      { label: 'demo.explore.editor.notice', where: { literal: 'Admin → Content → Notices' } },
      {
        label: 'demo.explore.editor.traffic',
        where: { literal: 'Admin → Analytics' },
        experimental: true
      }
    ]
  },
  {
    audience: 'demo.explore.developer.audience',
    items: [
      { label: 'demo.explore.developer.schema', where: { literal: 'server/api/collections.ts' } },
      { label: 'demo.explore.developer.localApi', where: { literal: 'routes/api/site/*' } },
      {
        label: 'demo.explore.developer.client',
        where: { literal: 'app.routes.ts, pages/admin' }
      },
      {
        label: 'demo.explore.developer.migrations',
        where: { literal: 'migrations.ts, docs/BACKUP-RESTORE.md' }
      },
      {
        label: 'demo.explore.developer.analytics',
        where: { literal: 'server/analytics, app.config.ts' },
        experimental: true
      },
      {
        label: 'demo.explore.developer.agent',
        where: { literal: 'scripts/agent-dogfood.test.mjs' },
        experimental: true
      }
    ]
  }
];
