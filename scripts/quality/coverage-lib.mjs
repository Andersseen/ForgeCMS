// Pure coverage arithmetic for `pnpm test:coverage` (spec 089), kept apart from the runner so the gate is
// unit-tested (scripts/quality-gates.test.mjs). Inputs are istanbul-format file coverage objects
// (`statementMap`/`s`, `fnMap`/`f`, `branchMap`/`b`) as Vitest's `json` reporter writes them.

/** Adds `source`'s hit counts into `target`; both must describe the same source file. */
export function addInto(target, source) {
  for (const k of Object.keys(source.s)) target.s[k] = (target.s[k] ?? 0) + source.s[k];
  for (const k of Object.keys(source.f)) target.f[k] = (target.f[k] ?? 0) + source.f[k];
  for (const k of Object.keys(source.b)) {
    target.b[k] = source.b[k].map((n, i) => (target.b[k]?.[i] ?? 0) + n);
  }
}

/**
 * Merges several runs' reports (path → coverage). A file appearing in more than one run (e.g. a contract
 * source executed by every adapter's suite) has its hit counts summed; two runs that disagree on a file's
 * statement map are NOT silently combined.
 */
export function mergeRuns(runs) {
  const files = new Map();
  for (const [label, report] of Object.entries(runs)) {
    for (const [path, coverage] of Object.entries(report)) {
      const existing = files.get(path);
      if (!existing) files.set(path, structuredClone(coverage));
      else if (JSON.stringify(existing.statementMap) === JSON.stringify(coverage.statementMap)) {
        addInto(existing, coverage);
      } else {
        throw new Error(`incompatible coverage maps for ${path} (run: ${label})`);
      }
    }
  }
  return files;
}

/** The package a `packages/<name>/src/…` path belongs to, else `null`. */
export function ownerOf(path) {
  const match = /\/packages\/([^/]+)\/src\//.exec(path.replaceAll('\\', '/'));
  return match ? match[1] : null;
}

const percent = ([covered, total]) =>
  total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;

/** Statement / branch / function / line totals over a package's files. A line is covered if any statement on it ran. */
export function summarise(files) {
  const statements = [0, 0];
  const functions = [0, 0];
  const branches = [0, 0];
  const lines = new Map();
  for (const { path, coverage } of files) {
    for (const [id, hits] of Object.entries(coverage.s)) {
      statements[1]++;
      if (hits > 0) statements[0]++;
      const key = `${path}:${coverage.statementMap[id].start.line}`;
      lines.set(key, (lines.get(key) ?? false) || hits > 0);
    }
    for (const hits of Object.values(coverage.f)) {
      functions[1]++;
      if (hits > 0) functions[0]++;
    }
    for (const arms of Object.values(coverage.b)) {
      for (const hits of arms) {
        branches[1]++;
        if (hits > 0) branches[0]++;
      }
    }
  }
  const lineTotals = [[...lines.values()].filter(Boolean).length, lines.size];
  const entry = (pair) => ({ covered: pair[0], total: pair[1], pct: percent(pair) });
  return {
    statements: entry(statements),
    branches: entry(branches),
    functions: entry(functions),
    lines: entry(lineTotals)
  };
}

/** Which metrics of `totals` fall under the class `floor`. */
export function metricsBelow(totals, floor) {
  return Object.keys(floor).filter((metric) => totals[metric].pct < floor[metric]);
}

/** Builds the per-package report and the list of failures from merged files and the floors config. */
export function evaluate(files, floors, packages) {
  const report = {};
  const failures = [];
  for (const pkg of packages) {
    const owned = [...files.entries()]
      .filter(([path]) => ownerOf(path) === pkg)
      .map(([path, coverage]) => ({ path, coverage }));
    const totals = summarise(owned);
    const klass = floors.packages[pkg];
    const floor = floors.classes[klass];
    const below = metricsBelow(totals, floor);
    report[pkg] = {
      class: klass,
      files: owned.length,
      ...totals,
      floor,
      environment: floors.environments[pkg],
      pass: below.length === 0,
      below
    };
    if (below.length > 0) {
      failures.push(
        `${pkg}: ${below.map((m) => `${m} ${totals[m].pct} < ${floor[m]}`).join(', ')}`
      );
    }
  }
  return { report, failures };
}

/** `[3,4,5,9]` → `"3-5, 9"`. */
export function ranges(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j === i ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Per-file coverage and the source lines holding an uncovered statement, branch arm or function. */
export function perFile(files) {
  const out = [];
  for (const [path, coverage] of files) {
    const owner = ownerOf(path);
    if (owner === null) continue;
    const missed = [];
    for (const [id, hits] of Object.entries(coverage.s)) {
      if (hits === 0) missed.push(coverage.statementMap[id].start.line);
    }
    for (const [id, arms] of Object.entries(coverage.b)) {
      arms.forEach((hits, arm) => {
        if (hits === 0) {
          const location = coverage.branchMap[id].locations[arm];
          missed.push(location?.start?.line ?? coverage.branchMap[id].loc.start.line);
        }
      });
    }
    for (const [id, hits] of Object.entries(coverage.f)) {
      if (hits === 0) missed.push(coverage.fnMap[id].loc.start.line);
    }
    const totals = summarise([{ path, coverage }]);
    out.push({
      package: owner,
      file: path.slice(path.indexOf(`/packages/${owner}/`) + 1),
      statements: totals.statements.pct,
      branches: totals.branches.pct,
      functions: totals.functions.pct,
      lines: totals.lines.pct,
      uncoveredLines: ranges(missed)
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
