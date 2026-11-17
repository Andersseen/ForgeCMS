import { describe, expect, it } from 'vitest';
import { authThrottleFor } from '../server/api/auth-throttle';

describe('demo auth throttle wiring (spec 106)', () => {
  it('local development and e2e (no D1 binding) stay unthrottled', async () => {
    expect(await authThrottleFor(undefined)).toBeUndefined();
    expect(await authThrottleFor({})).toBeUndefined();
  });
});
