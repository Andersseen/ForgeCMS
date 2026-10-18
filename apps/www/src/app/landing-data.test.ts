import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORGE_VERSION,
  FORGE_CHANNELS,
  FORGE_PACKAGES,
  agentInstallCommand,
  packageVersionLabel
} from './forge-release';
import {
  analyticsFacts,
  capabilityGroups,
  localizationExample,
  packages,
  exampleCode,
  showcasePost,
  showcaseResponse
} from './landing-data';
import { V2_MILESTONES } from './roadmap-data';

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

  it('shows one shipped baseline and the canonical V2 checkpoint statuses', () => {
    expect(CURRENT_FORGE_VERSION).toBe('1.0.0');
    expect(V2_MILESTONES).toHaveLength(10);
    expect(V2_MILESTONES[0]?.id).toBe('V2-01');
    expect(V2_MILESTONES[0]?.status).toBe('Next');
    expect(V2_MILESTONES.slice(1).every((milestone) => milestone.status === 'Planned')).toBe(true);
  });
});
