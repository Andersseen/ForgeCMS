import { describe, expect, it } from 'vitest';
import { adminPackage } from './index';

describe('admin placeholder', () => {
  it('exports package metadata', () => {
    expect(adminPackage.status).toBe('placeholder');
  });
});
