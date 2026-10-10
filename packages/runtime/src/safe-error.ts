/**
 * What an unexpected dependency failure is allowed to look like in a log line (spec 089): the error's
 * class name and, when it is a short machine code such as `ECONNRESET` or `SQLITE_BUSY`, that code.
 * Never the message, stack or properties — a database driver, storage SDK or host error routinely
 * quotes whatever it was handed (a connection string, a signed URL, a key id, a Bearer token) there.
 * Auth handlers have always logged this way (spec 069); every other unexpected-error path shares it.
 */
export function describeErrorForLog(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? `${err.name} (${code})`
    : err.name;
}
