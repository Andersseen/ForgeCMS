import type { D1Database } from '@forge-cms/cloudflare';
import { PUBLIC_DAILY_BUDGETS } from './demo-limits';

/**
 * The shared public demo's mutation policy — an **allowlist**, not a denylist.
 *
 * Two modes, chosen by one explicit flag and nothing inferred (not the hostname, not a missing
 * secret, not `NODE_ENV`):
 *
 * - **full** (default): the maintainer / local / e2e demo. Every dogfood operation works.
 * - **public** (`FORGE_PUBLIC_DEMO=1`): the hosted example anyone can reach with the published
 *   credentials. Visitors can sign in, browse, edit and publish the localized notices, send a booking
 *   and read Analytics. Everything else that would mutate is refused with a stable `code`.
 *
 * This is deployment policy of *this app*. ForgeCMS itself has no such limits.
 */

export type DemoMode = 'full' | 'public';

/** Reads the explicit flag from the Cloudflare env, falling back to the process env locally. */
export function resolveDemoMode(env?: { FORGE_PUBLIC_DEMO?: string }): DemoMode {
  // This app's tsconfig has no Node types, and Workers may have no `process`: read it defensively.
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const flag = env?.FORGE_PUBLIC_DEMO ?? processEnv?.['FORGE_PUBLIC_DEMO'];
  return flag === '1' ? 'public' : 'full';
}

/** What a request is allowed to do in public mode. */
export type MutationClass =
  | 'CONTENT_UPDATE'
  | 'BOOKING_CREATE'
  | 'AUTH_LOGIN'
  | 'ANALYTICS_COLLECT'
  | 'PASS';

/** Classes that spend the persistent (D1) daily budget. */
export type BudgetedClass = keyof typeof PUBLIC_DAILY_BUDGETS;

export type DemoDenialCode =
  | 'demo_uploads_disabled'
  | 'demo_delete_disabled'
  | 'demo_create_disabled'
  | 'demo_accounts_disabled'
  | 'demo_read_only'
  | 'demo_budget_exhausted'
  | 'demo_budget_unavailable'
  | 'demo_rate_limited'
  | 'demo_payload_too_large';

export type Decision =
  | { action: 'allow'; cls: MutationClass }
  | { action: 'deny'; status: 403; code: DemoDenialCode; message: string };

const deny = (code: DemoDenialCode): Decision => ({
  action: 'deny',
  status: 403,
  code,
  message: DEMO_MESSAGES[code]
});

/** Visitor-facing sentences. No provider, quota or account detail ever appears in them. */
export const DEMO_MESSAGES: Record<DemoDenialCode, string> = {
  demo_uploads_disabled:
    'Uploads are disabled in the shared public demo to keep the hosted example inexpensive. Run ForgeCMS in your own project to use uploads.',
  demo_delete_disabled:
    'Deleting content is disabled in the shared public demo so the example stays intact for everyone.',
  demo_create_disabled:
    'Creating new documents is disabled in the shared public demo. You can edit and publish the notices.',
  demo_accounts_disabled: 'Accounts are managed by the demo. Sign in with the published account.',
  demo_read_only:
    'This content is read-only in the shared public demo. You can edit and publish the notices.',
  demo_budget_exhausted:
    "The shared demo has reached today's write limit. Browsing still works; try again tomorrow.",
  demo_budget_unavailable:
    'Changes are paused in the shared demo right now. Browsing still works; try again later.',
  demo_rate_limited: 'Too many requests at once. Wait a moment and try again.',
  demo_payload_too_large: 'That request is larger than the shared demo accepts.'
};

const NOTICE_UPDATE = /^\/api\/v1\/notices\/[^/]+\/?$/;

/**
 * Classifies one mutating request in **public** mode. Pure: path and method in, decision out, so the
 * whole allowlist is unit-testable. `GET`/`HEAD`/`OPTIONS` never reach it.
 */
export function decide(method: string, rawPath: string): Decision {
  const path = rawPath.split('?')[0] ?? rawPath;
  const verb = method.toUpperCase();

  if (path === '/api/auth/login' && verb === 'POST') return { action: 'allow', cls: 'AUTH_LOGIN' };
  if (path === '/api/auth/logout' && verb === 'POST') return { action: 'allow', cls: 'PASS' };
  if (path === '/api/analytics/collect' && verb === 'POST') {
    return { action: 'allow', cls: 'ANALYTICS_COLLECT' };
  }
  if (path === '/api/site/bookings' && verb === 'POST') {
    return { action: 'allow', cls: 'BOOKING_CREATE' };
  }
  // The one editable CMS surface: the localized notices (title/message/EN-ES/draft/publish).
  if (verb === 'PUT' && NOTICE_UPDATE.test(path)) return { action: 'allow', cls: 'CONTENT_UPDATE' };

  if (path.startsWith('/api/auth/')) return deny('demo_accounts_disabled');
  if (path === '/api/v1/media' && verb === 'POST') return deny('demo_uploads_disabled');
  if (path.startsWith('/api/v1/')) {
    if (verb === 'DELETE') return deny('demo_delete_disabled');
    if (verb === 'POST') return deny('demo_create_disabled');
    return deny('demo_read_only');
  }
  return deny('demo_read_only');
}

// --- The persistent daily budget -----------------------------------------------------------------

export interface BudgetResult {
  allowed: boolean;
  /** Why a call was refused. Absent when allowed. */
  reason?: 'exhausted' | 'unavailable';
}

/**
 * A global counter per class per UTC day. `consume` must be atomic: N allowed, N+1 refused, however
 * many callers race for the last slot.
 */
export interface BudgetStore {
  consume(cls: BudgetedClass, limit: number, now?: Date): Promise<BudgetResult>;
  /** Read-only: what is left today. Used by the policy endpoint; never writes. */
  remaining(now?: Date): Promise<Partial<Record<BudgetedClass, number>> | null>;
}

const dayKey = (now: Date): string => now.toISOString().slice(0, 10);
const bucketKey = (cls: string, now: Date): string => `${dayKey(now)}:${cls}`;

/** In-process budget: local development, tests, and deployments without a D1 binding. */
export class MemoryBudgetStore implements BudgetStore {
  readonly #used = new Map<string, number>();

  consume(cls: BudgetedClass, limit: number, now = new Date()): Promise<BudgetResult> {
    const key = bucketKey(cls, now);
    const used = this.#used.get(key) ?? 0;
    // Single-threaded: check-and-increment cannot interleave.
    if (used >= limit) return Promise.resolve({ allowed: false, reason: 'exhausted' });
    this.#used.set(key, used + 1);
    return Promise.resolve({ allowed: true });
  }

  remaining(now = new Date()): Promise<Partial<Record<BudgetedClass, number>>> {
    const out: Partial<Record<BudgetedClass, number>> = {};
    for (const cls of Object.keys(PUBLIC_DAILY_BUDGETS) as BudgetedClass[]) {
      out[cls] = Math.max(
        0,
        PUBLIC_DAILY_BUDGETS[cls] - (this.#used.get(bucketKey(cls, now)) ?? 0)
      );
    }
    return Promise.resolve(out);
  }
}

/**
 * The deployed budget. One row per class per UTC day in `demo_budget` (created by the reviewed
 * migration `20261015_001_demo_budget`, never at startup). No IP, no user, no payload is stored —
 * only `{ bucket, used }`.
 *
 * - **Atomic**: a single `INSERT … ON CONFLICT DO UPDATE … WHERE used < limit RETURNING` statement.
 *   When the bucket is full the `WHERE` fails, nothing is written and no row is returned.
 * - **Fails closed**: a missing table or any D1 error refuses the action.
 * - **Blocked traffic costs no D1**: once a bucket is seen exhausted this isolate refuses from memory
 *   for the rest of the UTC day.
 * - **Bounded**: at most one row per class per day; the first write of a new day deletes older rows.
 */
export class D1BudgetStore implements BudgetStore {
  readonly #db: D1Database;
  readonly #exhausted = new Set<string>();

  constructor(db: D1Database) {
    this.#db = db;
  }

  async consume(cls: BudgetedClass, limit: number, now = new Date()): Promise<BudgetResult> {
    const bucket = bucketKey(cls, now);
    if (limit <= 0 || this.#exhausted.has(bucket)) return { allowed: false, reason: 'exhausted' };

    try {
      const row = await this.#db
        .prepare(
          `INSERT INTO demo_budget (bucket, used) VALUES (?, 1)
           ON CONFLICT(bucket) DO UPDATE SET used = used + 1 WHERE used < ?
           RETURNING used`
        )
        .bind(bucket, limit)
        .first<{ used: number }>();

      if (!row) {
        this.#exhausted.add(bucket);
        return { allowed: false, reason: 'exhausted' };
      }
      if (row.used >= limit) this.#exhausted.add(bucket);
      if (row.used === 1) {
        // First use of this bucket: forget older days. Bounded by the primary key, runs once a day
        // per class, and `bucket < 'YYYY-MM-DD'` orders by date because the key leads with it.
        await this.#db
          .prepare('DELETE FROM demo_budget WHERE bucket < ?')
          .bind(dayKey(now))
          .run()
          .catch(() => undefined);
      }
      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'unavailable' };
    }
  }

  async remaining(now = new Date()): Promise<Partial<Record<BudgetedClass, number>> | null> {
    try {
      const { results } = await this.#db
        .prepare('SELECT bucket, used FROM demo_budget WHERE bucket LIKE ?')
        .bind(`${dayKey(now)}:%`)
        .all<{ bucket: string; used: number }>();
      const used = new Map(results.map((row) => [row.bucket, row.used]));
      const out: Partial<Record<BudgetedClass, number>> = {};
      for (const cls of Object.keys(PUBLIC_DAILY_BUDGETS) as BudgetedClass[]) {
        out[cls] = Math.max(0, PUBLIC_DAILY_BUDGETS[cls] - (used.get(bucketKey(cls, now)) ?? 0));
      }
      return out;
    } catch {
      return null;
    }
  }
}

let memoryStore: MemoryBudgetStore | undefined;
const d1Stores = new WeakMap<object, D1BudgetStore>();

/** D1 when the deployment has the binding, otherwise one in-process store. */
export function getBudgetStore(env?: { DB?: D1Database }): BudgetStore {
  if (env?.DB) {
    let store = d1Stores.get(env.DB);
    if (!store) {
      store = new D1BudgetStore(env.DB);
      d1Stores.set(env.DB, store);
    }
    return store;
  }
  memoryStore ??= new MemoryBudgetStore();
  return memoryStore;
}

/** Test seam. */
export function resetMemoryBudget(): void {
  memoryStore = undefined;
}

/** What the admin and the deployment check may read about the active policy. No secrets, no ids. */
export interface PolicySummary {
  mode: DemoMode;
  editable: string[];
  restricted: string[];
  remaining?: Partial<Record<BudgetedClass, number>>;
}

export const PUBLIC_EDITABLE = [
  'Sign in with the published account',
  'Edit and publish the localized notices (EN / ES)',
  'Send a booking from the public site',
  'View Analytics when configured'
];

export const PUBLIC_RESTRICTED = [
  'Deleting content',
  'Creating new documents',
  'Uploading files',
  'Creating or editing accounts',
  'Editing services, staff, pages and site settings'
];
