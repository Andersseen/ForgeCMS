/**
 * A compare-and-set on `updated_at` is only as fine as the millisecond the adapters stamp. Before a CAS
 * write, wait until the clock has passed the stamp that was read, so this write's own stamp is strictly
 * later: a concurrent CAS writer that read the same row then cannot match it (spec 066 review). Bounded:
 * at most a few milliseconds. Clock skew *between* processes is outside what this can see.
 */
export async function afterStamp(stamp: unknown): Promise<void> {
  const seen = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  if (Number.isNaN(seen)) return;
  for (let i = 0; i < 20 && Date.now() <= seen; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
