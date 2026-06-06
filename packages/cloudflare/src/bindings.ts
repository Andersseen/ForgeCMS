/**
 * Minimal Cloudflare Workers binding types used by ForgeCMS.
 *
 * These mirror `@cloudflare/workers-types` so the package compiles even
 * without the full types installed, but we recommend adding
 * `@cloudflare/workers-types` for accurate intellisense.
 */

/** D1 Database binding — Cloudflare's edge SQLite */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: {
    duration: number;
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/** R2 Bucket binding — Cloudflare's S3-compatible object storage */
export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
    }
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: { limit?: number; prefix?: string; cursor?: string }): Promise<R2Objects>;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
  range?: R2Range;
  checksums: R2Checksums;
  uploaded: Date;
  version: string;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2Range {
  offset: number;
  length: number;
}

export interface R2Checksums {
  md5?: ArrayBuffer;
  sha1?: ArrayBuffer;
  sha256?: ArrayBuffer;
  sha384?: ArrayBuffer;
  sha512?: ArrayBuffer;
}

/** KV Namespace binding — Cloudflare's key-value store */
export interface KVNamespace {
  get(
    key: string,
    options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
  ): Promise<string | null>;
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown | null>;
  get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>;
}

export interface KVListResult {
  keys: { name: string; expiration?: number; metadata?: unknown }[];
  list_complete: boolean;
  cursor?: string;
}

/** Typical Cloudflare Pages Functions environment */
export interface CloudflareEnv {
  /** D1 database binding */
  DB?: D1Database;
  /** R2 bucket binding */
  BUCKET?: R2Bucket;
  /** KV namespace binding */
  KV?: KVNamespace;
  /** Any additional bindings (secrets, etc.) */
  [key: string]: unknown;
}
