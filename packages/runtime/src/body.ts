import { InvalidInputError, PayloadTooLargeError } from './errors.js';

/**
 * Default bound for an auth JSON body (spec 069): `{ email, password, name }` at their own bounds —
 * a 1024-character password (≤ 3 KB of UTF-8), a 254-character email and a 256-character name — plus
 * keys and whitespace, with room to spare. A request needs a fraction of it.
 */
export const DEFAULT_AUTH_MAX_BODY_BYTES = 8 * 1024;

/** No configuration may raise a bounded body above this. */
const MAX_BODY_BYTES_CEILING = 1024 * 1024;

export interface ReadBoundedJsonOptions {
  /** Defaults to {@link DEFAULT_AUTH_MAX_BODY_BYTES}. An integer between 1 and 1 MiB. */
  maxBytes?: number;
}

/**
 * Validates a configured bound. Called by the auth handlers before their error mapping, so a bad value
 * is a thrown configuration error with its message intact, not a redacted `500` on every request.
 */
export function resolveMaxBodyBytes(maxBytes: number | undefined): number {
  const value = maxBytes ?? DEFAULT_AUTH_MAX_BODY_BYTES;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BODY_BYTES_CEILING) {
    throw new Error(
      `maxBodyBytes must be an integer between 1 and ${MAX_BODY_BYTES_CEILING}; got ${String(value)}.`
    );
  }
  return value;
}

function cancelQuietly(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  // Best effort: stop the upstream sender. A body that is already locked or closed has nothing to cancel.
  body.cancel().catch(() => undefined);
}

/**
 * Reads a JSON-object request body without ever holding more than `maxBytes` of it (spec 069).
 *
 * 1. A valid `Content-Length` over the bound is refused before any read.
 * 2. The stream is read chunk by chunk and cancelled as soon as the running total passes the bound — a
 *    missing or lying `Content-Length` cannot get past it.
 * 3. The bytes must be valid UTF-8 and parse as JSON, and the value must be a plain object.
 *
 * Throws `PayloadTooLargeError` (`413`) or `InvalidInputError` (`400`); neither message contains any of
 * the body. Web Streams only — runs unchanged on Workers, Node, Deno and Bun.
 */
export async function readBoundedJsonObject(
  request: Request,
  options: ReadBoundedJsonOptions = {}
): Promise<Record<string, unknown>> {
  const maxBytes = resolveMaxBodyBytes(options.maxBytes);

  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    cancelQuietly(request.body);
    throw new PayloadTooLargeError();
  }

  if (request.bodyUsed) throw new InvalidInputError('Request body was already read');
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidInputError('Invalid JSON body');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidInputError('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}
