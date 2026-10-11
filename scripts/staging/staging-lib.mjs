import { createHash } from 'node:crypto';

/**
 * Repository tooling for the R03 staging + recovery rehearsal (spec 090). Not a Forge package API.
 *
 * Everything here is pure or read-only: it names the isolated staging resources, REFUSES production
 * identifiers, builds (never runs) the wrangler command lines, derives the required R2 keys from a D1
 * snapshot, and judges a served origin. Mutating execution lives in staging.mjs behind `--apply`.
 */

/** Every staging resource must start with this; nothing else is ever accepted as a mutation target. */
export const STAGING_PREFIX = 'forge-cms-r03-';

/** Known production / shared identifiers a staging command must never touch (names AND D1 ids). */
export const PRODUCTION_IDENTIFIERS = Object.freeze([
  'forge-cms',
  'forge-cms-demo',
  'forge-cms-demo-media',
  'forge-cms-tiny-project',
  '1b95312e-12c4-4d5e-b282-6d5067772754'
]);

const NAME_RE = /^[a-z0-9][a-z0-9-]{2,57}[a-z0-9]$/;

export class StagingGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagingGuardError';
  }
}

/** Throws unless `name` is an isolated R03 staging name. `what` only labels the error. */
export function assertStagingName(name, what = 'resource') {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new StagingGuardError(`${what}: an explicit target name is required`);
  }
  const lowered = name.trim().toLowerCase();
  if (PRODUCTION_IDENTIFIERS.some((id) => lowered === id || lowered.includes(`/${id}`))) {
    throw new StagingGuardError(`${what}: "${name}" is a known production/shared identifier`);
  }
  if (!lowered.startsWith(STAGING_PREFIX)) {
    throw new StagingGuardError(`${what}: "${name}" must start with "${STAGING_PREFIX}"`);
  }
  if (!NAME_RE.test(lowered) || lowered !== name) {
    throw new StagingGuardError(`${what}: "${name}" is not a valid lowercase staging name`);
  }
  return name;
}

/** A backup or restore may never write onto its own source. */
export function assertDistinct(source, target, what = 'resource') {
  if (source === target) {
    throw new StagingGuardError(`${what}: source and target are both "${source}"`);
  }
}

/**
 * The staging manifest: the exact remote resources R03 may create. `suffix` (lowercase alphanumerics) keeps a
 * re-run from colliding with a retained set; every name still starts with STAGING_PREFIX.
 */
export function buildManifest({ suffix = '' } = {}) {
  if (suffix !== '' && !/^[a-z0-9]{2,8}$/.test(suffix)) {
    throw new StagingGuardError('suffix must be 2-8 lowercase alphanumerics');
  }
  const s = suffix === '' ? '' : `-${suffix}`;
  const manifest = {
    prefix: STAGING_PREFIX,
    app: 'apps/tiny-project',
    resources: [
      resource(
        'pages',
        `${STAGING_PREFIX}staging${s}`,
        'staging app',
        'persistent',
        'source of the rehearsal'
      ),
      resource('d1', `${STAGING_PREFIX}staging-db${s}`, 'staging database', 'persistent', 'DB'),
      resource(
        'r2',
        `${STAGING_PREFIX}staging-media${s}`,
        'staging objects',
        'persistent',
        'BUCKET'
      ),
      resource(
        'pages',
        `${STAGING_PREFIX}restore${s}`,
        'restored app',
        'disposable',
        'recovery target'
      ),
      resource('d1', `${STAGING_PREFIX}restore-db${s}`, 'restore database', 'disposable', 'DB'),
      resource(
        'r2',
        `${STAGING_PREFIX}restore-media${s}`,
        'restore objects',
        'disposable',
        'BUCKET'
      ),
      resource(
        'worker',
        `${STAGING_PREFIX}r2-copy${s}`,
        'metadata-preserving R2 copy',
        'disposable',
        'SOURCE+TARGET'
      )
    ]
  };
  for (const r of manifest.resources) assertStagingName(r.name, `${r.kind} ${r.purpose}`);
  return manifest;
}

function resource(kind, name, purpose, lifetime, binding) {
  return { kind, name, purpose, lifetime, binding };
}

export const find = (manifest, kind, purpose) => {
  const found = manifest.resources.find((r) => r.kind === kind && r.purpose === purpose);
  if (!found) throw new StagingGuardError(`manifest has no ${kind} "${purpose}"`);
  return found.name;
};

/**
 * The exact wrangler argv for each mutating step. Pure: nothing runs. Every name passes the guard here,
 * so no code path can build a command for a production resource.
 */
export function buildCommands(manifest, { commit, origin } = {}) {
  const pages = assertStagingName(find(manifest, 'pages', 'staging app'), 'pages');
  const d1 = assertStagingName(find(manifest, 'd1', 'staging database'), 'd1');
  const r2 = assertStagingName(find(manifest, 'r2', 'staging objects'), 'r2');
  const w = (...argv) => ['wrangler', ...argv];
  return {
    provision: [
      w('d1', 'create', d1),
      w('r2', 'bucket', 'create', r2),
      w('pages', 'project', 'create', pages, '--production-branch', 'main')
    ],
    // AUTH_SECRET is piped on stdin by staging.mjs and never appears in argv or logs.
    secrets: [w('pages', 'secret', 'put', 'AUTH_SECRET', '--project-name', pages)],
    deploy: [
      w(
        'pages',
        'deploy',
        'dist/analog/public',
        '--project-name',
        pages,
        '--branch',
        'main',
        ...(commit ? ['--commit-hash', commit] : []),
        '--commit-dirty=false'
      )
    ],
    exportD1: (outFile) => [w('d1', 'export', d1, '--remote', '--output', outFile)],
    importD1: (restoreName, file) => [
      w('d1', 'create', assertStagingName(restoreName, 'restore d1')),
      w('d1', 'execute', restoreName, '--remote', '--file', file, '--yes')
    ],
    origin
  };
}

/** Sha-256 hex of bytes/string. */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Backup files are named by a hash of the key, never by the key (keys may contain `../`, slashes, Unicode). */
export const keyFileName = (key) => `${sha256(key)}.bin`;

/**
 * Derives the REQUIRED R2 keys from a D1 export (`wrangler d1 export` SQL), the single source of truth —
 * never from listing the live bucket (no pagination; spec 073/084). Loads the SQL into an in-memory SQLite
 * and reads `_storageKey` from every table that has the column.
 */
export async function keysFromSnapshotSql(sql) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    const keys = new Set();
    for (const { name } of tables) {
      const columns = db
        .prepare(`PRAGMA table_info("${String(name).replaceAll('"', '""')}")`)
        .all();
      if (!columns.some((c) => c.name === '_storageKey')) continue;
      const rows = db
        .prepare(
          `SELECT "_storageKey" AS k FROM "${String(name).replaceAll('"', '""')}" WHERE "_storageKey" IS NOT NULL`
        )
        .all();
      for (const row of rows) if (typeof row.k === 'string' && row.k !== '') keys.add(row.k);
    }
    return [...keys].sort();
  } finally {
    db.close();
  }
}

/** Compares a source backup entry to what the restored bucket returned; returns the list of mismatches. */
export function compareObject(expected, actual) {
  const problems = [];
  if (!actual) return ['missing in target'];
  if (expected.sha256 !== actual.sha256) problems.push('sha256');
  if (expected.size !== actual.size) problems.push('size');
  if ((expected.contentType ?? null) !== (actual.contentType ?? null)) problems.push('contentType');
  if (
    JSON.stringify(sortObject(expected.customMetadata)) !==
    JSON.stringify(sortObject(actual.customMetadata))
  ) {
    problems.push('customMetadata');
  }
  return problems;
}

const sortObject = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));

/** Substrings that must never appear in a response body or log line. */
export const FORBIDDEN_IN_OUTPUT = Object.freeze([
  'passwordHash',
  '_sessionVersion',
  'AUTH_SECRET',
  'D1_ERROR',
  'SQLITE_',
  'too many SQL variables'
]);

export function findLeaks(text, extra = []) {
  return [...FORBIDDEN_IN_OUTPUT, ...extra].filter(
    (marker) => marker !== '' && text.includes(marker)
  );
}

/**
 * READ-ONLY health + exposure check of a served staging origin. No credentials, no writes (a single
 * anonymous request that is *expected* to be rejected is the only non-GET-safe probe, and it is a GET too).
 * `fetchImpl` is injectable for tests.
 */
export async function verifyOrigin(origin, { fetchImpl = fetch, secrets = [] } = {}) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new StagingGuardError(`origin "${origin}" is not a URL`);
  }
  if (url.protocol !== 'https:') throw new StagingGuardError('staging origin must be https');
  const host = url.hostname.toLowerCase();
  if (
    PRODUCTION_IDENTIFIERS.some(
      (id) => host === `${id}.pages.dev` || host.endsWith(`.${id}.pages.dev`)
    )
  ) {
    throw new StagingGuardError(`origin "${host}" is a production host`);
  }
  if (!host.startsWith(STAGING_PREFIX) && !host.includes(`.${STAGING_PREFIX}`)) {
    throw new StagingGuardError(`origin host must belong to a "${STAGING_PREFIX}*" Pages project`);
  }
  const checks = [
    {
      path: '/api/content/collections',
      status: 200,
      json: (b) => Array.isArray(b?.data) && b.data.length > 0
    },
    { path: '/api/site/posts', status: 200, json: (b) => b !== null && typeof b === 'object' },
    { path: '/api/account/me', status: 401 },
    { path: '/api/content/does-not-exist', status: 404 },
    { path: '/studio/login', status: 200, html: true },
    { path: '/', status: 200, html: true }
  ];
  const results = [];
  for (const check of checks) {
    const response = await fetchImpl(new URL(check.path, url), { redirect: 'manual' });
    const text = await response.text();
    const problems = [];
    if (response.status !== check.status)
      problems.push(`status ${response.status}, expected ${check.status}`);
    if (check.json) {
      try {
        if (!check.json(JSON.parse(text))) problems.push('payload rejected by validator');
      } catch {
        problems.push('body is not JSON');
      }
    }
    if (check.html && !/<html|<!doctype/i.test(text)) problems.push('body is not HTML');
    const leaks = findLeaks(text, secrets);
    if (leaks.length > 0) problems.push(`leaks: ${leaks.join(', ')}`);
    results.push({
      path: check.path,
      status: response.status,
      ok: problems.length === 0,
      problems
    });
  }
  return { origin: url.origin, ok: results.every((r) => r.ok), results };
}
