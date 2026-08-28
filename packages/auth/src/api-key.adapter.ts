import type { CollectionDefinition } from '@forge-cms/core';
import { defineCollection, defineField } from '@forge-cms/core';
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';
import type { AuthAdapter, AuthSession, AuthUser } from './index.js';
import { ForgeAuthError } from './index.js';
import { base64UrlEncode } from './token-signer.js';

const DEFAULT_PREFIX = 'forge';
const COLLECTION_SLUG = '_forge_api_keys';
const SECRET_BYTES = 32;

export interface ApiKeyAuthEnv {
  apiKeyDatabase?: DatabaseAdapter;
}

export interface ApiKeyAuthAdapterOptions {
  /**
   * Non-secret label prefixed to every issued key (e.g. `'forge'`, the default, or `'myapp'`).
   * Letters, digits, and hyphens only — no underscores, which are the token's own field separator.
   */
  prefix?: string;
}

/** Public, safe-to-list view of an API key. Never carries the hash or plaintext secret. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  /** Plaintext credential, shown only here — it is never persisted or returned again. */
  secret: string;
}

function assertValidPrefix(prefix: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(prefix)) {
    throw new Error(
      `ApiKeyAuthAdapter prefix '${prefix}' is invalid — use letters, digits, and hyphens only (no underscores).`
    );
  }
}

function buildApiKeysCollection(): CollectionDefinition {
  return defineCollection({
    slug: COLLECTION_SLUG,
    // Internal system collection: never registered in a consumer's `config.collections`, and denies
    // every operation here too, as defense in depth against ever being reachable through generic CRUD.
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false
    },
    fields: {
      name: defineField.text({ required: true }),
      prefix: defineField.text({ required: true }),
      secretHash: defineField.text({ required: true }),
      scopes: defineField.json<string[]>({ required: true }),
      metadata: defineField.json(),
      createdAt: defineField.text({ required: true }),
      expiresAt: defineField.text(),
      revokedAt: defineField.text(),
      lastUsedAt: defineField.text()
    }
  });
}

function generateSecret(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function toApiKey(record: DatabaseRecord): ApiKey {
  const scopes = Array.isArray(record.scopes) ? (record.scopes as string[]) : [];
  const metadata = record.metadata as Record<string, unknown> | null | undefined;
  const expiresAt = record.expiresAt as string | null | undefined;
  const revokedAt = record.revokedAt as string | null | undefined;
  const lastUsedAt = record.lastUsedAt as string | null | undefined;

  return {
    id: record.id as string,
    name: record.name as string,
    prefix: record.prefix as string,
    scopes,
    createdAt: record.createdAt as string,
    ...(metadata !== undefined && metadata !== null && { metadata }),
    ...(expiresAt !== undefined && expiresAt !== null && { expiresAt }),
    ...(revokedAt !== undefined && revokedAt !== null && { revokedAt }),
    ...(lastUsedAt !== undefined && lastUsedAt !== null && { lastUsedAt })
  };
}

function isActive(record: DatabaseRecord, now: Date): boolean {
  const revokedAt = record.revokedAt as string | null | undefined;
  if (revokedAt) return false;
  const expiresAt = record.expiresAt as string | null | undefined;
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Auth adapter for machine credentials ("API keys"). Secrets are generated with Web Crypto
 * (`crypto.getRandomValues`), never stored (only a SHA-256 digest is persisted), and returned in
 * plaintext exactly once, at creation. A valid key resolves to an `AuthUser` with `role: 'machine'`
 * and the key's configured `scopes`/`metadata`, so it flows through the same access-control pipeline
 * as any human user — see `hasScope`/`hasAnyScope`/`hasAllScopes`.
 *
 * Persists through the configured `DatabaseAdapter` in an internal system collection
 * (`_forge_api_keys`) that is never part of a consumer's `config.collections`, so it cannot be reached
 * through generic `/api/v1/*` CRUD. Call `syncSchema()` (or let `ForgeCmsRuntime.syncSchema()` call it)
 * before first use.
 */
export class ApiKeyAuthAdapter implements AuthAdapter {
  readonly name = 'api-key';
  private readonly prefix: string;
  private db?: DatabaseAdapter;

  constructor(options: ApiKeyAuthAdapterOptions = {}) {
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    assertValidPrefix(this.prefix);
  }

  init(env?: ApiKeyAuthEnv): this {
    if (env?.apiKeyDatabase !== undefined) {
      this.db = env.apiKeyDatabase;
    }
    return this;
  }

  private getDb(): DatabaseAdapter {
    if (!this.db) {
      throw new Error('ApiKeyAuthAdapter not initialized. Call init() with { apiKeyDatabase }.');
    }
    return this.db;
  }

  async syncSchema(): Promise<void> {
    await this.getDb().syncSchema([buildApiKeysCollection()]);
  }

  extractToken(request: Request): string | null {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match?.[1]) return null;
    const token = match[1].trim();
    return token.length > 0 ? token : null;
  }

  /**
   * Parses `<prefix>_<recordId>_<secret>`. `recordId` is a hyphenated UUID (no underscores), so the
   * first underscore after the prefix unambiguously separates it from `secret` even though `secret`
   * (base64url) may itself contain underscores. Returns `null` for anything not shaped like our own
   * key — the cheap format check that lets `CompositeAuthAdapter` skip a DB round-trip for tokens
   * belonging to a different auth strategy.
   */
  private parseToken(token: string): { id: string; secret: string } | null {
    const marker = `${this.prefix}_`;
    if (!token.startsWith(marker)) return null;
    const rest = token.slice(marker.length);
    const separatorIndex = rest.indexOf('_');
    if (separatorIndex <= 0) return null;
    const id = rest.slice(0, separatorIndex);
    const secret = rest.slice(separatorIndex + 1);
    if (!id || !secret) return null;
    return { id, secret };
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    const parsed = this.parseToken(token);
    if (!parsed) return null;

    const db = this.getDb();
    const record = await db.findById(COLLECTION_SLUG, parsed.id);
    if (!record) return null;
    if (!isActive(record, new Date())) return null;

    const storedHash = record.secretHash as string | undefined;
    if (!storedHash) return null;
    const candidateHash = await hashSecret(parsed.secret);
    if (!timingSafeEqualHex(candidateHash, storedHash)) return null;

    try {
      await db.update(COLLECTION_SLUG, parsed.id, { lastUsedAt: new Date().toISOString() });
    } catch {
      // lastUsedAt is observability metadata, not part of authentication correctness.
    }

    const scopes = Array.isArray(record.scopes) ? (record.scopes as string[]) : [];
    const metadata = record.metadata as Record<string, unknown> | null | undefined;

    const user: AuthUser = {
      id: record.id as string,
      name: record.name as string,
      role: 'machine',
      scopes,
      ...(metadata !== undefined && metadata !== null && { metadata })
    };

    return { user };
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    if (!token) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    const session = await this.validateSession(token);
    if (!session) throw new ForgeAuthError('Unauthorized', 'unauthorized');
    return session.user;
  }

  async createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const db = this.getDb();
    const secret = generateSecret();
    const secretHash = await hashSecret(secret);

    const record = await db.create(COLLECTION_SLUG, {
      name: input.name,
      prefix: this.prefix,
      secretHash,
      scopes: input.scopes ?? [],
      createdAt: new Date().toISOString(),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt })
    });

    return { apiKey: toApiKey(record), secret: `${this.prefix}_${record.id as string}_${secret}` };
  }

  async listApiKeys(): Promise<ApiKey[]> {
    const records = await this.getDb().findMany({ collection: COLLECTION_SLUG });
    return records.map(toApiKey);
  }

  async getApiKey(id: string): Promise<ApiKey | null> {
    const record = await this.getDb().findById(COLLECTION_SLUG, id);
    return record ? toApiKey(record) : null;
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.getDb().update(COLLECTION_SLUG, id, { revokedAt: new Date().toISOString() });
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.getDb().delete(COLLECTION_SLUG, id);
  }
}
