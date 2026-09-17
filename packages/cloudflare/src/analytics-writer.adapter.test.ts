import { describe, expect, it } from 'vitest';
import { runAnalyticsWriterContractTests } from '@forge-cms/testing/contracts';
import { AnalyticsEngineWriter, NoopAnalyticsWriter } from './analytics-writer.adapter.js';
import type { AnalyticsEngineDataPoint, AnalyticsEngineDataset } from './bindings.js';

function createSpyDataset(): {
  dataset: AnalyticsEngineDataset;
  writes: AnalyticsEngineDataPoint[];
} {
  const writes: AnalyticsEngineDataPoint[] = [];
  return { dataset: { writeDataPoint: (event) => writes.push(event) }, writes };
}

runAnalyticsWriterContractTests(() => {
  const { dataset, writes } = createSpyDataset();
  const adapter = new AnalyticsEngineWriter().init({ ANALYTICS: dataset });
  return { adapter, writes };
});

describe('AnalyticsEngineWriter', () => {
  it('throws if the ANALYTICS binding is missing', () => {
    const adapter = new AnalyticsEngineWriter();
    expect(() => adapter.init({})).toThrow('AnalyticsEngineWriter requires env.ANALYTICS binding');
  });

  it('reads a custom binding name', () => {
    const { dataset, writes } = createSpyDataset();
    const adapter = new AnalyticsEngineWriter({ binding: 'SITE_ANALYTICS' });
    adapter.init({ SITE_ANALYTICS: dataset });

    adapter.recordPageview({ siteId: 's', pathname: '/', referrerHost: '', country: '' });
    expect(writes).toHaveLength(1);
  });

  it('names the binding it looked for when it is missing', () => {
    const adapter = new AnalyticsEngineWriter({ binding: 'SITE_ANALYTICS' });
    expect(() => adapter.init({ ANALYTICS: {} })).toThrow(
      'AnalyticsEngineWriter requires env.SITE_ANALYTICS binding'
    );
  });

  it('throws if recordPageview is called before init', () => {
    const adapter = new AnalyticsEngineWriter();
    expect(() =>
      adapter.recordPageview({ siteId: 's', pathname: '/', referrerHost: '', country: '' })
    ).toThrow('AnalyticsEngineWriter not initialized. Call init() first.');
  });
});

describe('NoopAnalyticsWriter', () => {
  it('has a name and never throws', () => {
    const adapter = new NoopAnalyticsWriter();
    expect(adapter.name).toBe('noop-analytics');
    expect(() =>
      adapter.recordPageview({ siteId: 's', pathname: '/', referrerHost: '', country: '' })
    ).not.toThrow();
  });
});
