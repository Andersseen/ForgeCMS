import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { createSandboxRuntime, scenarios } from './sandbox';

interface ScenarioResult {
  name: string;
  status: 'ok' | 'threw';
  output: string;
  ms: number;
}

/**
 * A local scratchpad, not a demo: it runs every scenario in `sandbox.ts` against a real
 * `ForgeCmsRuntime` on in-memory adapters and prints what came back. Each scenario gets its own
 * fresh runtime, so they cannot interfere with each other.
 *
 * The realistic, presentable example lives in `apps/demo-aesthetics`.
 */
@Component({
  selector: 'forge-playground-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <header class="head">
        <div>
          <p class="eyebrow">ForgeCMS</p>
          <h1>Sandbox</h1>
          <p class="summary">
            Edit <code>src/app/sandbox.ts</code> and save. Every scenario runs against a real
            runtime on in-memory adapters — the full pipeline, no server, no database.
          </p>
        </div>
        <button type="button" (click)="run()" [disabled]="running()">
          {{ running() ? 'Running…' : 'Re-run' }}
        </button>
      </header>

      @for (result of results(); track result.name) {
        <article class="scenario" [class.threw]="result.status === 'threw'">
          <div class="scenario-head">
            <span class="name">{{ result.name }}</span>
            <span class="meta">
              {{ result.status === 'threw' ? 'threw' : 'ok' }} · {{ result.ms }}ms
            </span>
          </div>
          <pre>{{ result.output }}</pre>
        </article>
      } @empty {
        <p class="summary">No scenarios yet — add one to <code>sandbox.ts</code>.</p>
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        color: #17202a;
        background: #f7f8fb;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
      }

      .shell {
        width: min(980px, calc(100% - 32px));
        margin: 0 auto;
        padding: 56px 0 96px;
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 32px;
      }

      .eyebrow {
        margin: 0 0 8px;
        color: #0f766e;
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.2rem);
        line-height: 1;
      }

      .summary {
        max-width: 640px;
        margin: 16px 0 0;
        color: #52606d;
        line-height: 1.65;
      }

      button {
        flex-shrink: 0;
        border: 1px solid #0f766e;
        border-radius: 8px;
        padding: 10px 18px;
        color: #ffffff;
        background: #0f766e;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.55;
        cursor: default;
      }

      code {
        border-radius: 6px;
        padding: 2px 6px;
        color: #0f766e;
        background: #e6fffb;
        font: inherit;
      }

      .scenario {
        margin-bottom: 16px;
        overflow: hidden;
        border: 1px solid #d9e2ec;
        border-radius: 10px;
        background: #ffffff;
      }

      .scenario.threw {
        border-color: #f3b3b3;
      }

      .scenario-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        border-bottom: 1px solid #eef2f6;
      }

      .name {
        font-weight: 650;
      }

      .meta {
        color: #7b8794;
        font-size: 0.8rem;
      }

      .threw .meta {
        color: #b91c1c;
      }

      pre {
        max-height: 340px;
        margin: 0;
        overflow: auto;
        padding: 16px;
        color: #243b53;
        background: #fbfcfe;
        font-size: 0.85rem;
        line-height: 1.6;
      }
    `
  ]
})
export class AppComponent implements OnInit {
  protected readonly results = signal<ScenarioResult[]>([]);
  protected readonly running = signal(false);

  ngOnInit(): void {
    void this.run();
  }

  protected async run(): Promise<void> {
    this.running.set(true);
    const collected: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      // A fresh runtime per scenario: seeded state from one must not leak into the next.
      const cms = await createSandboxRuntime();
      const started = performance.now();

      try {
        const value = await scenario.run(cms);
        collected.push({
          name: scenario.name,
          status: 'ok',
          output: format(value),
          ms: Math.round(performance.now() - started)
        });
      } catch (err) {
        collected.push({
          name: scenario.name,
          status: 'threw',
          output: formatError(err),
          ms: Math.round(performance.now() - started)
        });
      }
    }

    this.results.set(collected);
    this.running.set(false);
  }
}

function format(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, 2);
}

/** Errors from the Local API carry a status and, for validation failures, per-field details. */
function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const extra = err as Error & { status?: number; details?: unknown };
  return [
    `${err.name}: ${err.message}`,
    extra.status !== undefined ? `status: ${extra.status}` : '',
    extra.details !== undefined ? `details: ${JSON.stringify(extra.details, null, 2)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}
