/** Distribution of a set of millisecond samples. `max` is the tail indicator beside p95. */
export interface Distribution {
  samples: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function summarise(samples: readonly number[]): Distribution {
  if (samples.length === 0) throw new Error('no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  // Nearest-rank percentile: simple, deterministic, and exact for the sample counts used here.
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return {
    samples: sorted.length,
    min: round(sorted[0]!),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]!),
    mean: round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length)
  };
}

/** Runs `operation` `warmup` times unmeasured, then `iterations` times against a monotonic clock. */
export async function measure(
  operation: () => Promise<unknown>,
  options: { warmup: number; iterations: number }
): Promise<Distribution> {
  for (let i = 0; i < options.warmup; i++) await operation();
  const samples: number[] = [];
  for (let i = 0; i < options.iterations; i++) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return summarise(samples);
}
