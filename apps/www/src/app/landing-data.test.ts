import { describe, expect, it } from 'vitest';
import { CURRENT_FORGE_VERSION, FORGE_PACKAGES } from './forge-release';
import {
  ROADMAP_MILESTONES,
  features,
  packages,
  exampleCode,
  showcasePost,
  showcaseResponse
} from './landing-data';

describe('landing content', () => {
  it('uses the same illustrative record for the content and item API preview', () => {
    expect(JSON.parse(showcaseResponse)).toEqual({ data: showcasePost });
    expect(showcasePost._status).toBe('published');
    for (const field of ['title', 'slug', 'author']) expect(exampleCode).toContain(`${field}:`);
    expect(exampleCode).toContain('drafts: true');
  });
  it('derives every package card from the one current version', () => {
    expect(CURRENT_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packages.map((pkg) => pkg.name)).toEqual(FORGE_PACKAGES.map((pkg) => pkg.name));
    expect(new Set(packages.map((pkg) => pkg.version))).toEqual(new Set([CURRENT_FORGE_VERSION]));
  });

  it('lists all eleven public packages', () => {
    expect(packages.map((pkg) => pkg.name)).toEqual([
      'core',
      'db',
      'auth',
      'storage',
      's3',
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

  it('shows 0.7 and 0.8 Angular DX (C01–C03) complete, with 0.9 SSR next', () => {
    const upgrades = ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.7');
    expect(upgrades?.status).toBe('complete');
    expect(upgrades?.steps?.map((step) => step.status)).toEqual([
      'complete',
      'complete',
      'complete'
    ]);
    const angular = ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.8');
    expect(angular?.status).toBe('complete');
    expect(angular?.steps?.map((step) => step.status)).toEqual([
      'complete',
      'complete',
      'complete'
    ]);
    expect(ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.9')?.status).toBe(
      'complete'
    );
    expect(ROADMAP_MILESTONES.find((milestone) => milestone.version === '0.6')?.status).toBe(
      'complete'
    );
  });
});
