import { describe, expect, it } from 'vitest';
import { features, packages } from './landing-data';

describe('landing content', () => {
  it('presents the official app essentials', () => {
    expect(features.length).toBeGreaterThan(0);
    expect(packages).toContain('core');
  });
});
