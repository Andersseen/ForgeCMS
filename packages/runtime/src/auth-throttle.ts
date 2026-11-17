import type { CollectionDefinition } from '@forge-cms/core';
import { defineField } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord, SchemaPlan } from '@forge-cms/db';
import { isUniqueConstraintError } from '@forge-cms/db';
import type { AuthAttempt, AuthAttemptDecision, AuthAttemptThrottle } from './auth-handlers.js';

/**
 * Two certified ways to fill the login/signup `throttle` hook (spec 106, V2-01): one portable limiter that
 * keeps its counters in the database Forge already uses (libSQL, D1, any `DatabaseAdapter`), and one
 * adapter for Cloudflare's Rate Limiting bindings. Both use the documented keys: login is checked per
 * client **and** per account (the account budget is the larger one, so knowing an address is not enough to
 * lock its owner out), signup per client only. Nothing is throttled unless the host passes one.
 */

/** One fixed-window budget: at most `limit` attempts per key per `windowSeconds`. */
export interface AuthThrottleLimit {
  limit: number;
  windowSeconds: number;
}

/** The budgets of {@link DatabaseAuthThrottle}. Each one defaults independently. */
export interface AuthThrottleLimits {
  /** Login attempts per client. Default `{ limit: 10, windowSeconds: 60 }`. */
  loginClient?: AuthThrottleLimit;
  /** Login attempts per submitted account (email). Default `{ limit: 30, windowSeconds: 60 }`. */
  loginAccount?: AuthThrottleLimit;
  /** Signup attempts per client. Default `{ limit: 10, windowSeconds: 60 }`. */
  signupClient?: AuthThrottleLimit;
}

export interface DatabaseAuthThrottleOptions {
  /** An initialized adapter; usually the runtime's own database. */
  database: DatabaseAdapter;
  /**
   * The client key, from the request, used by {@link DatabaseAuthThrottle.throttle}. Omit it and use
   * {@link DatabaseAuthThrottle.forClient} instead when the route knows the client address itself (on
   * Node the socket address is not part of a Web `Request`: h3's `getRequestIP(event)`). There is no safe default, because only you know which address
   * header your platform or proxy sets and can be trusted (`cf-connecting-ip` on Cloudflare; on Node, the
   * address your trusted reverse proxy forwards). Never a header a client can set freely.
   */
  clientKey?: (request: Request) => string;
  limits?: AuthThrottleLimits;
}

const COLLECTION_SLUG = '_forge_auth_throttle';
const DEFAULT_LIMITS: Required<AuthThrottleLimits> = {
  loginClient: { limit: 10, windowSeconds: 60 },
  loginAccount: { limit: 30, windowSeconds: 60 },
  signupClient: { limit: 10, windowSeconds: 60 }
};
/** Compare-and-set retries per key before the attempt is refused (a brake under contention, never a pass). */
const MAX_CAS_ATTEMPTS = 8;
const MAX_WINDOW_SECONDS = 24 * 60 * 60;

function buildThrottleCollection(): CollectionDefinition {
  // Internal system collection (like `_forge_api_keys`): never in a consumer's `config.collections`,
  // and denies every operation as defense in depth against ever being reachable through generic CRUD.
  return {
    slug: COLLECTION_SLUG,
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false
    },
    fields: {
      windowStart: defineField.number({ required: true }),
      windowEnd: defineField.number({ required: true }),
      count: defineField.number({ required: true })
    }
  };
}

function resolveLimit(
  name: string,
  value: AuthThrottleLimit | undefined,
  fallback: AuthThrottleLimit
) {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit.limit) || limit.limit < 1) {
    throw new Error(`DatabaseAuthThrottle: limits.${name}.limit must be an integer ≥ 1.`);
  }
  if (
    !Number.isInteger(limit.windowSeconds) ||
    limit.windowSeconds < 1 ||
    limit.windowSeconds > MAX_WINDOW_SECONDS
  ) {
    throw new Error(
      `DatabaseAuthThrottle: limits.${name}.windowSeconds must be an integer between 1 and ${MAX_WINDOW_SECONDS}.`
    );
  }
  return { limit: limit.limit, windowSeconds: limit.windowSeconds };
}

/** Row ids are a digest of the key: no email or client address is ever stored. */
async function rowId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return `t1_${hex}`;
}

/**
 * A portable login/signup limiter whose counters live in the application's database (spec 106). Works on
 * every durable profile — Node + libSQL, Cloudflare D1 (including Pages, which has no Rate Limiting
 * binding) — survives restarts and is shared by every instance that uses the same database.
 *
 * Fixed windows, one row per key, every increment a compare-and-set (`updateIf`), so concurrent attempts
 * never under-count; contention beyond a few retries refuses the attempt. Each checked attempt costs one
 * read and one write per key (two keys for login). Call {@link syncSchema} once at startup (it creates
 * `_forge_auth_throttle`) and {@link prune} periodically to delete expired rows.
 *
 * ```ts
 * const limiter = new DatabaseAuthThrottle({ database, clientKey: (r) => r.headers.get('cf-connecting-ip') ?? 'unknown' });
 * await limiter.syncSchema();
 * handleLogin(context, { runtime, throttle: limiter.throttle });
 * ```
 */
export class DatabaseAuthThrottle {
  private readonly database: DatabaseAdapter;
  private readonly clientKey: ((request: Request) => string) | undefined;
  private readonly limits: Required<AuthThrottleLimits>;

  constructor(options: DatabaseAuthThrottleOptions) {
    if (options.clientKey !== undefined && typeof options.clientKey !== 'function') {
      throw new Error('DatabaseAuthThrottle: clientKey must be a function (request) => string.');
    }
    this.database = options.database;
    this.clientKey = options.clientKey;
    this.limits = {
      loginClient: resolveLimit(
        'loginClient',
        options.limits?.loginClient,
        DEFAULT_LIMITS.loginClient
      ),
      loginAccount: resolveLimit(
        'loginAccount',
        options.limits?.loginAccount,
        DEFAULT_LIMITS.loginAccount
      ),
      signupClient: resolveLimit(
        'signupClient',
        options.limits?.signupClient,
        DEFAULT_LIMITS.signupClient
      )
    };
  }

  /** Creates `_forge_auth_throttle` (idempotent, additive). */
  async syncSchema(): Promise<void> {
    await this.database.syncSchema([buildThrottleCollection()]);
  }

  /** Drift plan for `_forge_auth_throttle`; empty on a database without `planSchema`. */
  async planSchema(): Promise<SchemaPlan> {
    return (
      (await this.database.planSchema?.([buildThrottleCollection()])) ?? {
        changes: [],
        blocking: false
      }
    );
  }

  /**
   * The `throttle` option for `handleLogin` / `handleSignup`, keyed with `clientKey(request)`. Without a
   * configured `clientKey` it throws, so the handler fails closed (`500`) — use {@link forClient}.
   */
  readonly throttle: AuthAttemptThrottle = (attempt: AuthAttempt) => {
    if (!this.clientKey) {
      throw new Error('DatabaseAuthThrottle: no clientKey configured; use forClient(client).');
    }
    return this.check(attempt, this.clientKey(attempt.request));
  };

  /** A `throttle` for one request whose client address the route already knows. */
  forClient(client: string): AuthAttemptThrottle {
    return (attempt) => this.check(attempt, client);
  }

  private async check(attempt: AuthAttempt, client: string): Promise<AuthAttemptDecision> {
    const checks: [string, AuthThrottleLimit][] =
      attempt.action === 'login'
        ? [
            [`login:client:${client}`, this.limits.loginClient],
            [`login:account:${attempt.identifier}`, this.limits.loginAccount]
          ]
        : [[`signup:client:${client}`, this.limits.signupClient]];
    let retryAfterSeconds = 0;
    for (const [key, limit] of checks) {
      const decision = await this.consume(key, limit);
      if (!decision.allowed)
        retryAfterSeconds = Math.max(retryAfterSeconds, decision.retryAfterSeconds);
    }
    return retryAfterSeconds > 0 ? { allowed: false, retryAfterSeconds } : { allowed: true };
  }

  /**
   * Deletes up to `max` rows whose window has ended. Run it on a schedule (a cron trigger, a timer); a
   * deleted row only means its key starts a fresh window, so pruning never lets anyone exceed a budget.
   * Returns the number of rows deleted.
   */
  async prune(max = 500): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const expired = await this.database.findMany({
      collection: COLLECTION_SLUG,
      where: { windowEnd: { lt: now } },
      limit: max
    });
    let deleted = 0;
    for (const row of expired) {
      const result = await this.database.deleteIf(COLLECTION_SLUG, String(row.id), {
        targetMatches: { windowEnd: row.windowEnd as number }
      });
      if (result.applied) deleted += 1;
    }
    return deleted;
  }

  private async consume(
    key: string,
    limit: AuthThrottleLimit
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const id = await rowId(key);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - (now % limit.windowSeconds);
      const windowEnd = windowStart + limit.windowSeconds;
      const row: DatabaseRecord | null = await this.database.findById(COLLECTION_SLUG, id);

      if (!row) {
        try {
          await this.database.create(COLLECTION_SLUG, { id, windowStart, windowEnd, count: 1 });
          return { allowed: true };
        } catch (error) {
          if (isUniqueConstraintError(error)) continue; // a concurrent first attempt created it
          throw error;
        }
      }

      const current = { windowStart: Number(row.windowStart), count: Number(row.count) };
      if (current.windowStart !== windowStart) {
        const reset = await this.database.updateIf(
          COLLECTION_SLUG,
          id,
          { windowStart, windowEnd, count: 1 },
          { targetMatches: current }
        );
        if (reset.applied) return { allowed: true };
        continue;
      }
      if (current.count >= limit.limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, windowEnd - now) };
      }
      const incremented = await this.database.updateIf(
        COLLECTION_SLUG,
        id,
        { count: current.count + 1 },
        { targetMatches: current }
      );
      if (incremented.applied) return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: limit.windowSeconds };
  }
}

/** The part of a Cloudflare Rate Limiting binding this adapter uses (`env.MY_LIMITER`). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitBindingAuthThrottleOptions {
  /** Checked for every login and signup attempt, keyed `<action>:client:<client>`. */
  client: RateLimitBinding;
  /** Checked for login attempts only, keyed `login:account:<email>`. Give it the larger budget. */
  account: RateLimitBinding;
  /** See {@link DatabaseAuthThrottleOptions.clientKey}. On Cloudflare: `cf-connecting-ip`. */
  clientKey: (request: Request) => string;
  /** The `Retry-After` of a refusal: the bindings' `period` (10 or 60). Default `60`. */
  retryAfterSeconds?: number;
}

/**
 * The Cloudflare-native option (spec 106): Workers [Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
 * one per budget. Cloudflare documents their counters as local to each location and eventually
 * consistent: a brake, not an exact count. Pages Functions have no such binding — use
 * {@link DatabaseAuthThrottle} on D1 there.
 */
export function rateLimitBindingAuthThrottle(
  options: RateLimitBindingAuthThrottleOptions
): AuthAttemptThrottle {
  const retryAfterSeconds = options.retryAfterSeconds ?? 60;
  return async ({ action, identifier, request }): Promise<AuthAttemptDecision> => {
    const client = options.clientKey(request);
    const checks = [options.client.limit({ key: `${action}:client:${client}` })];
    if (action === 'login') {
      checks.push(options.account.limit({ key: `login:account:${identifier}` }));
    }
    const results = await Promise.all(checks);
    return results.every((result) => result.success)
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds };
  };
}
