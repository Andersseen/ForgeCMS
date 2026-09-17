import type { AnalyticsEngineDataset } from './bindings.js';
import { toPageviewDataPoint, type AnalyticsPageviewInput } from './analytics-schema.js';

export interface AnalyticsWriter {
  readonly name: string;
  init(env?: unknown): this;
  recordPageview(input: AnalyticsPageviewInput): void;
}

export interface AnalyticsEngineWriterOptions {
  /** Which binding on `env` holds the dataset. Defaults to `'ANALYTICS'`. */
  binding?: string;
}

/** Writes pageviews to a Cloudflare Analytics Engine binding. */
export class AnalyticsEngineWriter implements AnalyticsWriter {
  readonly name = 'analytics-engine';
  private dataset?: AnalyticsEngineDataset;
  private readonly binding: string;

  constructor(options: AnalyticsEngineWriterOptions = {}) {
    this.binding = options.binding ?? 'ANALYTICS';
  }

  init(env: unknown): this {
    const bindings = (env ?? {}) as Record<string, AnalyticsEngineDataset | undefined>;
    const dataset = bindings[this.binding];
    if (!dataset) {
      throw new Error(`AnalyticsEngineWriter requires env.${this.binding} binding`);
    }
    this.dataset = dataset;
    return this;
  }

  private getDataset(): AnalyticsEngineDataset {
    if (!this.dataset) throw new Error('AnalyticsEngineWriter not initialized. Call init() first.');
    return this.dataset;
  }

  /**
   * Fire-and-forget, matching `writeDataPoint()`'s own contract — never awaited, and `writeDataPoint`
   * itself never throws (Cloudflare drops invalid data points silently rather than raising). This
   * method still throws if called before `init()`, the same programmer-error guard every other
   * adapter in this package uses — callers are expected to always `init()` first, not to catch this.
   */
  recordPageview(input: AnalyticsPageviewInput): void {
    this.getDataset().writeDataPoint(toPageviewDataPoint(input));
  }
}

/** Used when no Analytics Engine binding is configured — collection becomes a silent no-op. */
export class NoopAnalyticsWriter implements AnalyticsWriter {
  readonly name = 'noop-analytics';

  init(): this {
    return this;
  }

  recordPageview(_input: AnalyticsPageviewInput): void {
    // Analytics not configured for this deployment — intentionally does nothing.
  }
}
