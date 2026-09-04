import { describe, expect, it } from 'vitest';
import { features, packages } from './landing-data';

describe('landing content', () => {
  it('presents the official app essentials', () => {
    expect(features.length).toBeGreaterThan(0);
    expect(packages).toContainEqual({ name: 'core', version: '0.4.0' });
  });
});
