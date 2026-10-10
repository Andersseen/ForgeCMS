// Pure budget evaluation for `pnpm test:performance` (spec 089) — separate from the runner so the gate itself
// is unit-tested (scripts/quality-gates.test.mjs): a gate that cannot fail is not a gate.

/** Reads `path` (array of keys) out of the merged measurement results. */
export function valueAt(results, path) {
  let node = results;
  for (const key of path) node = node?.[key];
  return node;
}

function resolveValue(results, metric) {
  if (metric.ratio) {
    const [a, b] = metric.ratio.map((path) => valueAt(results, path));
    return typeof a === 'number' && typeof b === 'number' && b !== 0
      ? Math.round((a / b) * 100) / 100
      : undefined;
  }
  if (metric.difference) {
    const [a, b] = metric.difference.map((path) => valueAt(results, path));
    return typeof a === 'number' && typeof b === 'number' ? a - b : undefined;
  }
  return valueAt(results, metric.path);
}

const groupOf = (metric) =>
  metric.path?.[0] ?? metric.ratio?.[0]?.[0] ?? metric.difference?.[0]?.[0];

/**
 * Judges every metric. Statuses: `ok`, `improved` (an exact metric below its baseline — update the baseline),
 * `review` (above the review line, below the budget), `recorded` (report-only without a budget), `over (report-only)`,
 * and for hard gates `OVER BUDGET` / `MISSING`. Only hard failures count.
 */
export function judge(budgets, results, { skipBundle = false } = {}) {
  const rows = [];
  let hardFailures = 0;
  for (const metric of budgets.metrics) {
    if (skipBundle && groupOf(metric) === 'bundle') continue;
    const value = resolveValue(results, metric);
    const hard = metric.gate === 'hard';
    let status;
    if (value === undefined) {
      status = hard ? 'MISSING' : 'missing';
      if (hard) hardFailures++;
    } else if (metric.budget === null || metric.budget === undefined) {
      status = 'recorded';
    } else if (value > metric.budget) {
      status = hard ? 'OVER BUDGET' : 'over (report-only)';
      if (hard) hardFailures++;
    } else if (metric.review !== undefined && value > metric.review) {
      status = 'review';
    } else {
      status = metric.exact && value < metric.baseline ? 'improved' : 'ok';
    }
    rows.push({
      id: metric.id,
      gate: metric.gate,
      unit: metric.unit,
      baseline: metric.baseline,
      budget: metric.budget,
      value,
      status
    });
  }
  return { rows, hardFailures };
}
