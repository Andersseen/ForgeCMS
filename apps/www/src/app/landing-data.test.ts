import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORGE_VERSION,
  FORGE_CHANNELS,
  FORGE_PACKAGES,
  agentInstallCommand,
  packageVersionLabel
} from './forge-release';
import {
  ROADMAP_MILESTONES,
  analyticsFacts,
  capabilityGroups,
  localizationExample,
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
  it('derives every stable package card from the one current version', () => {
    expect(CURRENT_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packages.map((pkg) => pkg.name)).toEqual(FORGE_PACKAGES.map((pkg) => pkg.name));
    const stable = packages.filter((pkg) => pkg.availability === 'stable');
    expect(new Set(stable.map((pkg) => pkg.version))).toEqual(new Set([CURRENT_FORGE_VERSION]));
  });

  it('lists all twelve public packages, including s3 and the experimental agent', () => {
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
      'testing',
      'agent'
    ]);
    expect(
      packages.filter((pkg) => pkg.availability === 'experimental').map((p) => p.name)
    ).toEqual(['agent']);
  });

  it('shows the stable version for the published experimental Agent Kit', () => {
    const agent = packages.find((pkg) => pkg.name === 'agent');
    expect(agent?.version).toBe(packageVersionLabel({ name: 'agent' }));
    expect(agent?.version).toBe(CURRENT_FORGE_VERSION);
    // The install command exists exactly when the registry confirms the package.
    expect(agentInstallCommand() !== null).toBe(FORGE_CHANNELS.agentPublished);
    if (!FORGE_CHANNELS.agentPublished) expect(agentInstallCommand()).toBeNull();
  });

  it('describes capabilities, not a future', () => {
    const copy = JSON.stringify(capabilityGroups);
    expect(copy).not.toMatch(/future|0\.4\./i);
    expect(copy).not.toMatch(/production[- ]ready|payload replacement|1\.0 stable/i);
  });

  it('groups capabilities by value and claims only supported localization', () => {
    expect(capabilityGroups.map((group) => group.id)).toEqual([
      'content',
      'backend',
      'angular',
      'operations'
    ]);
    const copy = JSON.stringify([localizationExample.points, localizationExample.limits]);
    expect(copy).toMatch(/top-level text and textarea/i);
    expect(copy).toMatch(/not localized/i);
    expect(localizationExample.schema).not.toMatch(/richtext|blocks|array|upload|relation/);
  });

  it('shows only the Analytics metrics that exist', () => {
    const copy = JSON.stringify(analyticsFacts).toLowerCase();
    for (const absent of ['unique visitor', 'session', 'funnel', 'heatmap', 'conversion'])
      expect(copy).not.toContain(absent);
    expect(analyticsFacts.ranges).toEqual(['24h', '7d', '30d', '90d']);
  });

  it('marks the stable 1.0 release complete after publication', () => {
    const one = ROADMAP_MILESTONES.find((milestone) => milestone.version === '1.0');
    expect(one?.status).toBe('complete');
    expect(one?.npm).toBe('1.0.0');
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

  it('explains the jump to 1.0: checkpoint 0.12 shipped as npm 0.13.x', () => {
    const find = (v: string) => ROADMAP_MILESTONES.find((m) => m.version === v);
    expect(find('0.12')?.npm).toBe('0.13.x');
    expect(find('0.11')?.npm).toBe('0.12.x – 0.13.0');
    expect(ROADMAP_MILESTONES.some((m) => m.version === '0.13')).toBe(false);
  });
});
