/**
 * SYNTHETIC qualification data. These credentials and canaries exist only for automated tests against a
 * throwaway database; never reuse them for a real deployment.
 */
// Order matters: ForgeCMS provisions the FIRST user of a fresh install as admin, whatever role is asked.
export const EDITORS = {
  ada: {
    email: 'ada@editorial.test',
    password: 'qualification-only-ada-c4e8',
    name: 'Ada Admin',
    role: 'admin'
  },
  ana: {
    email: 'ana@editorial.test',
    password: 'qualification-only-ana-7f3c',
    name: 'Ana Ortega',
    role: 'editor'
  },
  ben: {
    email: 'ben@editorial.test',
    password: 'qualification-only-ben-91d2',
    name: 'Ben Okafor',
    role: 'editor'
  },
  vic: {
    email: 'vic@editorial.test',
    password: 'qualification-only-vic-2a6b',
    name: 'Vic Viewer',
    role: 'viewer'
  }
} as const;

/** Strings that must appear ONLY where the access policy allows them. */
export const CANARIES = {
  anaDraft: 'DRAFT_CANARY_ANA_5b1f',
  benDraft: 'DRAFT_CANARY_BEN_e07a',
  authSecret: 'AUTH_SECRET_CANARY_3d9a0c7e5b1f42d8a6c0e9b7f1d3a5c8'
} as const;

export const POSTS = [
  {
    slug: 'welcome-to-the-desk',
    title: 'Welcome to the desk',
    author: 'ana',
    status: 'published',
    text: 'The desk publishes reviewed stories every week.'
  },
  {
    slug: 'ana-draft-investigation',
    title: 'Unfinished investigation',
    author: 'ana',
    status: 'draft',
    text: `Sources pending. ${CANARIES.anaDraft}`
  },
  {
    slug: 'ben-draft-column',
    title: 'Column in progress',
    author: 'ben',
    status: 'draft',
    text: `Outline only. ${CANARIES.benDraft}`
  },
  {
    slug: 'ben-published-column',
    title: 'On local newsrooms',
    author: 'ben',
    status: 'published',
    text: 'Local reporting needs patient editors.'
  }
] as const;
