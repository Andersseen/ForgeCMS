import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORGE_VERSION,
  CURRENT_RC_VERSION,
  FORGE_CHANNELS,
  FORGE_PACKAGES,
  agentInstallCommand,
  packageVersionLabel
} from './forge-release';

// Stable publication recorded by main CI run 39063229523; keep the accepted RC as release history
// and Agent Kit as experimental.
describe('release channels', () => {
  it('reports the published stable line', () => {
    expect(CURRENT_FORGE_VERSION).toBe('1.0.0');
    expect(CURRENT_FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the public candidate as a prerelease, never the stable version', () => {
    expect(CURRENT_RC_VERSION).toBe('1.0.0-rc.2');
    expect(CURRENT_RC_VERSION).toMatch(/^1\.0\.0-rc\.\d+$/);
    expect(CURRENT_RC_VERSION).not.toBe(CURRENT_FORGE_VERSION);
  });

  it('reports the candidate and the Agent Kit as published', () => {
    expect(FORGE_CHANNELS.rcPublished).toBe(true);
    expect(FORGE_CHANNELS.stablePublished).toBe(true);
    expect(FORGE_CHANNELS.agentPublished).toBe(true);
  });

  it('labels Agent Kit with the stable package version while preserving its experimental status', () => {
    expect(packageVersionLabel({ name: 'agent' })).toBe('1.0.0');
    expect(packageVersionLabel({ name: 'core' })).toBe(CURRENT_FORGE_VERSION);
    expect(agentInstallCommand()).toBe('pnpm add -D @forge-cms/agent@1.0.0');
  });

  it('lists twelve packages of which only the Agent Kit is experimental', () => {
    expect(FORGE_PACKAGES).toHaveLength(12);
    expect(
      FORGE_PACKAGES.filter((pkg) => pkg.availability === 'experimental').map((pkg) => pkg.name)
    ).toEqual(['agent']);
  });
});
