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
    title: 'Edit a treatment',
    detail:
      'Change the category by searching for it, add a benefit row, write a paragraph in the description. No ids, no JSON.'
  },
  {
    title: 'Send yourself a booking',
    detail:
      'Fill in the booking form on the public site, then open Bookings in the CMS. It arrives as pending, and only staff can see it.'
  },
  {
    title: 'Change the clinic settings',
    detail:
      'Phone, address and opening hours live in Clinic settings; the site header and footer follow immediately.'
  }
];

/** For an Angular developer deciding whether this is worth adopting. */
export const DEVELOPER_STEPS: DemoStep[] = [
  {
    title: 'The content model is one TypeScript file',
    detail:
      'apps/demo-aesthetics/src/server/api/collections.ts — eleven collections with drafts, hooks, row-level access rules and composite fields. That file is the whole schema.'
  },
  {
    title: 'The server talks to the CMS with no HTTP hop',
    detail:
      'src/server/routes/api/site/home.get.ts composes five collections into one payload through the Local API (runtime.find/create), with access control and draft rules applied.'
  },
  {
    title: 'Public writes are decided by the collection, not the route',
    detail:
      'The booking form posts as nobody. The bookings collection allows it via access.create, and a hook forces status back to pending so a crafted request cannot self-confirm.'
  },
  {
    title: 'The admin is a package, not app code',
    detail:
      '@forge-cms/admin ships the layout, the list and the schema-driven form; the app supplies routes, a sidebar config and about 300 lines of glue.'
  },
  {
    title: 'Run the tests to see the rules',
    detail:
      'pnpm test:demo — 22 tests drive the content model through the Local API: who can read a booking, what a draft is invisible to, what a hook rewrites.'
  }
];
