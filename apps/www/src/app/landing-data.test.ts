import { describe, expect, it } from 'vitest';
import { CURRENT_FORGE_VERSION, FORGE_PACKAGES } from './forge-release';
import { ROADMAP_MILESTONES, features, packages } from './landing-data';

describe('landing content', () => {
  it('derives every package card from the one current version', () => {
    expect(CURRENT_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packages.map((pkg) => pkg.name)).toEqual(FORGE_PACKAGES.map((pkg) => pkg.name));
    expect(new Set(packages.map((pkg) => pkg.version))).toEqual(new Set([CURRENT_FORGE_VERSION]));
  });

  it('lists all ten public packages', () => {
    expect(packages.map((pkg) => pkg.name)).toEqual([
      'core',
      'db',
      'auth',
      'storage',
      'api',
      'runtime',
      'cloudflare',
      'angular',
      'admin',
      'testing'
    ]);
  });

  it('describes capabilities, not a future', () => {
    const copy = JSON.stringify(features);
    expect(copy).not.toMatch(/future|0\.4\./i);
    expect(copy).not.toMatch(/production[- ]ready|payload replacement|1\.0 stable/i);
  });

  it('shows 0.7 as complete (M01–M03) and 0.8 Angular DX as next', () => {
    const upgrades = ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.7');
    expect(upgrades?.status).toBe('complete');
    expect(upgrades?.steps?.map((step) => step.status)).toEqual([
      'complete',
      'complete',
      'complete'
    ]);
    expect(ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.8')?.status).toBe(
      'next'
    );
    expect(ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.6')?.status).toBe(
      'complete'
    );
  });
});
