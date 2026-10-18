import { describe, expect, it } from 'vitest';
import { V2_MILESTONES } from './roadmap-data';

describe('canonical ForgeCMS 2.0 roadmap inventory', () => {
  it('has ten unique milestones in stable product order', () => {
    const ids = V2_MILESTONES.map(({ id }) => id);
    expect(ids).toEqual(
      Array.from({ length: 10 }, (_, index) => `V2-${String(index + 1).padStart(2, '0')}`)
    );
    expect(new Set(ids).size).toBe(10);
  });

  it('uses only explicit roadmap statuses and has one next checkpoint', () => {
    expect(V2_MILESTONES.map(({ status }) => status)).toEqual([
      'Next',
      ...Array.from({ length: 9 }, () => 'Planned')
    ]);
  });
});
