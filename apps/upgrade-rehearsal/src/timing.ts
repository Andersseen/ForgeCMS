import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Operational evidence, not a benchmark (spec 073 §69): phase durations of each rehearsal run. */
export const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.rehearsal');

export class Timings {
  private readonly phases: Record<string, number> = {};

  constructor(private readonly label: string) {}

  async time<T>(phase: string, run: () => Promise<T> | T): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      this.phases[phase] = Math.round(performance.now() - started);
    }
  }

  /** Appends one JSON line to `.rehearsal/timings.jsonl` and prints it. */
  record(): void {
    const line = JSON.stringify({ run: this.label, ms: this.phases });
    mkdirSync(REPORT_DIR, { recursive: true });
    appendFileSync(join(REPORT_DIR, 'timings.jsonl'), `${line}\n`);
    console.log(`[timing] ${line}`);
  }
}
