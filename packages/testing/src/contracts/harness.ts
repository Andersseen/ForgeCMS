// Small helpers shared by the concurrency contracts. They live here (not copy-pasted per contract) so
// the harness's own failure diagnostics are unit-tested once (harness.test.ts, spec 089).

/** `'ok'` for a fulfilled outcome, else the rejection's `code` (or the raw reason when it is not an object). */
export function codeOf(outcome: PromiseSettledResult<unknown>): unknown {
  if (outcome.status === 'fulfilled') return 'ok';
  const reason: unknown = outcome.reason;
  return typeof reason === 'object' && reason !== null
    ? (reason as { code?: unknown }).code
    : reason;
}

/** Fails fast, with an actionable message, when a `setup()` hands back the wrong number of contenders. */
export function requireContenders<T>(
  contenders: readonly T[],
  parties: number
): readonly [T, ...T[]] {
  if (parties < 1 || contenders.length !== parties) {
    throw new Error(`setup() must return exactly ${parties} contenders`);
  }
  return contenders as readonly [T, ...T[]];
}

/** {@link requireContenders} for the common two-party race. */
export function requirePair<T>(contenders: readonly T[]): readonly [T, T] {
  const [a, ...rest] = requireContenders(contenders, 2);
  return [a, rest[0] as T];
}

/**
 * Which racer won: the index of the single fulfilled outcome. Contracts index per-racer tables with it
 * (`[expectedIfFirstWon, expectedIfSecondWon][winnerIndex(outcomes)]`) instead of branching on a race
 * result that no single run can take both ways.
 */
export function winnerIndex(outcomes: readonly PromiseSettledResult<unknown>[]): number {
  const fulfilled = outcomes.flatMap((outcome, index) =>
    outcome.status === 'fulfilled' ? [index] : []
  );
  if (fulfilled.length !== 1) {
    throw new Error(`expected exactly one winner, got ${fulfilled.length} of ${outcomes.length}`);
  }
  return fulfilled[0] as number;
}
