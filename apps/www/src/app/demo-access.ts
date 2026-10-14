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
  { role: 'Admin', email: 'demo@lumea.clinic', password: 'lumea-demo' },
  { role: 'Front desk (editor)', email: 'frontdesk@lumea.clinic', password: 'lumea-desk' }
] as const;

export interface DemoStep {
  title: string;
  detail: string;
}

/** For someone who will only ever use the UI — the person a CMS is actually for. */
export const EDITOR_STEPS: DemoStep[] = [
  {
    title: 'Look at the clinic site first',
    detail:
      'Every word, price, image and opening hour on it is content, not code. The home page itself is a list of blocks an editor arranged.'
  },
  {
    title: 'Sign in and open Treatments',
    detail:
      'One treatment is a draft: it has a Draft badge and it is missing from the public menu. Hit Publish on its row and reload the site — it is there.'
  },
  {
    title: 'Switch the site between EN and ES',
    detail:
      'The "From the clinic" notice at the top is localized content. Open Content, then Notices, edit it in one locale, switch the locale and edit the other: each language keeps its own text.'
  },
  {
    title: 'Send yourself a booking',
    detail:
      'Fill in the booking form on the public site, then open Bookings in the CMS. It arrives as pending, and only staff can see it.'
  },
  {
    title: 'Upload a photo, change the settings',
    detail:
      'Add an image in Media. Phone, address and opening hours live in Clinic settings; the site header and footer follow immediately.'
  },
  {
    title: 'Check the site traffic (experimental)',
    detail:
      'The overview and Analytics pages show real visits from Cloudflare Analytics Engine when it is configured, or say plainly that it is not. There are never placeholder numbers.'
  }
];

/** For an Angular developer deciding whether this is worth adopting. */
export const DEVELOPER_STEPS: DemoStep[] = [
  {
    title: 'The content model is one TypeScript file',
    detail:
      'apps/demo-aesthetics/src/server/api/collections.ts — twelve collections with drafts, hooks, row-level access rules, composite fields and one localized collection. That file is the whole schema.'
  },
  {
    title: 'The server talks to the CMS with no HTTP hop',
    detail:
      'src/server/routes/api/site/home.get.ts composes five collections into one payload through the Local API (runtime.find/create), with access control and draft rules applied.'
  },
  {
    title: 'Localization uses the supported contract',
    detail:
      'The notices collection localizes top-level text and textarea fields only. The public read passes a locale and runs as an anonymous visitor, so drafts never leak in either language.'
  },
  {
    title: 'Public writes are decided by the collection, not the route',
    detail:
      'The booking form posts as nobody. The bookings collection allows it via access.create, and a hook forces status back to pending so a crafted request cannot self-confirm.'
  },
  {
    title: 'The admin is a package, not app code',
    detail:
      '@forge-cms/admin ships the layout, sign-in session, collection list, document editor and staff accounts. The app mounts its routes, sets its own navigation and keeps only clinic-specific pages.'
  },
  {
    title: 'Analytics and Agent Kit are dogfooded',
    detail:
      'Analytics (experimental) is wired with the documented recipe. The Agent Kit is development tooling: a test points its read-only MCP at this project and checks it is detected. It is not part of the demo runtime.'
  },
  {
    title: 'Run the tests to see the rules',
    detail:
      'pnpm test:demo drives the content model through the typed Local API: who can read a booking, what a draft is invisible to, what a hook rewrites, how a notice resolves per locale.'
  }
];

/** "What to explore": one line per capability the live demo really exercises. */
export interface DemoExploreItem {
  label: string;
  where: string;
  experimental?: boolean;
}

export const DEMO_EXPLORE: { audience: string; items: DemoExploreItem[] }[] = [
  {
    audience: 'Editor',
    items: [
      { label: 'Edit and publish content, drafts stay private', where: 'Admin → Treatments' },
      { label: 'Upload and reuse media', where: 'Admin → Media' },
      {
        label: 'Role-aware admin with a custom navigation',
        where: 'Sign in as Admin, then Front desk'
      },
      { label: 'Write the same notice in Spanish and English', where: 'Admin → Content → Notices' },
      { label: 'See site traffic', where: 'Admin → Analytics', experimental: true }
    ]
  },
  {
    audience: 'Developer',
    items: [
      { label: 'Code-first schema', where: 'server/api/collections.ts' },
      { label: 'Local API composition and access control', where: 'routes/api/site/*' },
      { label: 'Typed Angular client and package admin', where: 'app.routes.ts, pages/admin' },
      {
        label: 'Uploads, and reviewed migrations / recovery',
        where: 'migrations.ts, docs/BACKUP-RESTORE.md'
      },
      {
        label: 'Analytics integration',
        where: 'server/analytics, app.config.ts',
        experimental: true
      },
      {
        label:
          'Agent Kit can inspect a project like this (development tooling, not in the demo runtime)',
        where: 'scripts/agent-dogfood.test.mjs',
        experimental: true
      }
    ]
  }
];
