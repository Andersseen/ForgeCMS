import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORGE_VERSION,
  CURRENT_RC_VERSION,
  FORGE_CHANNELS,
  FORGE_PACKAGES,
  agentInstallCommand,
  packageVersionLabel
} from './forge-release';

// Registry truth verified 2026-10-17 (L01 closeout): rc → 1.0.0-rc.2 on all twelve packages, `latest` 0.13.4 on the
// eleven stable ones. The site must keep the three channels apart: stable, public RC, experimental.
describe('release channels', () => {
  it('keeps the stable line on a plain release until 1.0.0 ships', () => {
    expect(CURRENT_FORGE_VERSION).toBe('0.13.4');
    expect(CURRENT_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the public candidate as a prerelease, never the stable version', () => {
    expect(CURRENT_RC_VERSION).toBe('1.0.0-rc.2');
    expect(CURRENT_RC_VERSION).toMatch(/^1\.0\.0-rc\.\d+$/);
    expect(CURRENT_RC_VERSION).not.toBe(CURRENT_FORGE_VERSION);
  });

  it('reports the candidate and the Agent Kit as published', () => {
    expect(FORGE_CHANNELS.rcPublished).toBe(true);
    expect(FORGE_CHANNELS.agentPublished).toBe(true);
  });

  it('labels the Agent Kit with the rc channel and installs it from the rc tag only', () => {
    expect(packageVersionLabel({ name: 'agent' })).toBe('rc');
    expect(packageVersionLabel({ name: 'core' })).toBe(CURRENT_FORGE_VERSION);
    expect(agentInstallCommand()).toBe('pnpm add -D @forge-cms/agent@rc');
  });

  it('lists twelve packages of which only the Agent Kit is experimental', () => {
    expect(FORGE_PACKAGES).toHaveLength(12);
    expect(
      FORGE_PACKAGES.filter((pkg) => pkg.availability === 'experimental').map((pkg) => pkg.name)
    ).toEqual(['agent']);
  });
});
