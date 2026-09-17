import { beforeEach, describe, expect, it } from 'vitest';

interface ContractAnalyticsPoint {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

interface ContractPageviewInput {
  siteId: string;
  pathname: string;
  referrerHost: string;
  country: string;
}

interface ContractAnalyticsWriter {
  readonly name: string;
  init(env?: unknown): unknown;
  recordPageview(input: ContractPageviewInput): void;
}

/**
 * Analytics Engine's `writeDataPoint()` has no read-back API — unlike the database/storage
 * contracts, this can't assert a round trip. `createAdapter` returns both the adapter and the raw
 * points it wrote so far, so the suite can assert on write *shape* instead.
 */
export function runAnalyticsWriterContractTests(
  createAdapter: () => { adapter: ContractAnalyticsWriter; writes: ContractAnalyticsPoint[] }
) {
  describe('AnalyticsWriter contract', () => {
    let adapter: ContractAnalyticsWriter;
    let writes: ContractAnalyticsPoint[];

    beforeEach(() => {
      ({ adapter, writes } = createAdapter());
    });

    it('has a name', () => {
      expect(adapter.name).toBeTruthy();
      expect(typeof adapter.name).toBe('string');
    });

    it('records a pageview as exactly one write, indexed by site id', () => {
      adapter.recordPageview({ siteId: 'site-1', pathname: '/a', referrerHost: '', country: '' });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.indexes).toEqual(['site-1']);
    });

    it('never throws across repeated calls, matching writeDataPoint()’s own fire-and-forget contract', () => {
      expect(() => {
        adapter.recordPageview({ siteId: 's', pathname: '/', referrerHost: '', country: '' });
        adapter.recordPageview({
          siteId: 's',
          pathname: '/two',
          referrerHost: 'example.com',
          country: 'US'
        });
      }).not.toThrow();
      expect(writes).toHaveLength(2);
    });
  });
}
