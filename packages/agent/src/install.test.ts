import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MCP_CONFIG_FILE,
  SKILL_STAMP,
  bundledSkills,
  check,
  codexSnippet,
  detectPackageManager,
  install,
  mcpEntryFor
} from './install.js';
import { makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
function project(files: Record<string, string | object> = {}) {
  const made = makeProject({ 'package.json': { name: 'site' }, ...files });
  cleanups.push(made.cleanup);
  return made.root;
}
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const statuses = (report: ReturnType<typeof install>) => report.actions.map((a) => a.status);
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

describe('package manager and MCP entry', () => {
  it('detects the lockfile and defaults to pnpm', () => {
    expect(detectPackageManager(project())).toBe('pnpm');
    expect(detectPackageManager(project({ 'package-lock.json': '{}' }))).toBe('npm');
    expect(detectPackageManager(project({ 'yarn.lock': '' }))).toBe('yarn');
    expect(detectPackageManager(project({ 'bun.lock': '' }))).toBe('bun');
    expect(detectPackageManager(project({ 'pnpm-lock.yaml': '' }))).toBe('pnpm');
  });
  it('uses the local binary (never a global install or a download)', () => {
    expect(mcpEntryFor('pnpm')).toEqual({ command: 'pnpm', args: ['exec', 'forge-cms-mcp'] });
    expect(mcpEntryFor('npm').args).toContain('--no-install');
    expect(mcpEntryFor('yarn').command).toBe('yarn');
    expect(mcpEntryFor('bun').command).toBe('bunx');
    expect(codexSnippet(mcpEntryFor('pnpm'))).toContain('[mcp_servers.forge-cms]');
  });
});

describe('install', () => {
  it('creates the MCP entry and every bundled skill with a version stamp', () => {
    const root = project();
    const report = install({ root, targets: ['claude'] });
    expect(new Set(statuses(report))).toEqual(new Set(['create']));
    const config = JSON.parse(read(root, MCP_CONFIG_FILE));
    expect(config.mcpServers['forge-cms']).toEqual({
      command: 'pnpm',
      args: ['exec', 'forge-cms-mcp']
    });
    for (const name of bundledSkills()) {
      expect(read(root, `.claude/skills/${name}/SKILL.md`)).toContain(`name: ${name}`);
      expect(JSON.parse(read(root, `.claude/skills/${name}/${SKILL_STAMP}`)).version).toBe(
        report.version
      );
    }
    expect(bundledSkills().length).toBe(8);
  });

  it('is idempotent: a second run changes nothing', () => {
    const root = project();
    install({ root, targets: ['claude', 'agents'] });
    const again = install({ root, targets: ['claude', 'agents'] });
    expect(new Set(statuses(again))).toEqual(new Set(['unchanged']));
    expect(existsSync(join(root, '.agents/skills/forgecms-setup/SKILL.md'))).toBe(true);
  });

  it('merges into an existing .mcp.json without losing other servers or keys', () => {
    const root = project({
      '.mcp.json': { other: 1, mcpServers: { github: { command: 'gh', args: [] } } }
    });
    install({ root, targets: ['claude'] });
    const config = JSON.parse(read(root, MCP_CONFIG_FILE));
    expect(config.other).toBe(1);
    expect(config.mcpServers.github).toEqual({ command: 'gh', args: [] });
    expect(config.mcpServers['forge-cms'].command).toBe('pnpm');
  });

  it('never overwrites a differing entry without --force', () => {
    const root = project({
      '.mcp.json': { mcpServers: { 'forge-cms': { command: 'node', args: ['custom.js'] } } }
    });
    const report = install({ root, targets: ['claude'] });
    expect(report.actions[0]).toMatchObject({ kind: 'mcp', status: 'conflict' });
    expect(JSON.parse(read(root, MCP_CONFIG_FILE)).mcpServers['forge-cms'].command).toBe('node');
    const forced = install({ root, targets: ['claude'], force: true });
    expect(forced.actions[0]?.status).toBe('update');
    expect(JSON.parse(read(root, MCP_CONFIG_FILE)).mcpServers['forge-cms'].command).toBe('pnpm');
  });

  it('refuses to touch an invalid or non-object .mcp.json', () => {
    for (const content of ['{ not json', '[]', 'null']) {
      const root = project({ '.mcp.json': content });
      const report = install({ root, targets: ['claude'] });
      expect(report.actions[0]?.status).toBe('conflict');
      expect(read(root, MCP_CONFIG_FILE)).toBe(content);
    }
  });

  it('tolerates an mcpServers value that is not an object by replacing only that key', () => {
    const root = project({ '.mcp.json': { mcpServers: [] } });
    expect(install({ root, targets: ['claude'] }).actions[0]?.status).toBe('create');
  });

  it('does not overwrite a skill directory the user wrote, unless --force', () => {
    const root = project({ '.claude/skills/forgecms-setup/SKILL.md': 'my own notes' });
    const report = install({ root, targets: ['claude'] });
    const mine = report.actions.find((a) => a.path.endsWith('forgecms-setup'));
    expect(mine?.status).toBe('conflict');
    expect(read(root, '.claude/skills/forgecms-setup/SKILL.md')).toBe('my own notes');
    const forced = install({ root, targets: ['claude'], force: true });
    expect(forced.actions.find((a) => a.path.endsWith('forgecms-setup'))?.status).toBe('update');
    expect(read(root, '.claude/skills/forgecms-setup/SKILL.md')).toContain('name: forgecms-setup');
  });

  it('reports a non-directory in the way', () => {
    const root = project({ '.claude/skills/forgecms-setup': 'a file' });
    const report = install({ root, targets: ['claude'] });
    expect(report.actions.find((a) => a.path.endsWith('forgecms-setup'))).toMatchObject({
      status: 'conflict',
      detail: 'not a directory'
    });
  });

  it('refreshes a stale stamped skill (version or content drift) and leaves others alone', () => {
    const root = project();
    install({ root, targets: ['claude'] });
    writeFileSync(join(root, '.claude/skills/forgecms-setup', SKILL_STAMP), '{"version":"0.0.1"}');
    writeFileSync(join(root, '.claude/skills/forgecms-admin/SKILL.md'), 'edited locally');
    const report = install({ root, targets: ['claude'] });
    const changed = report.actions.filter((a) => a.status === 'update').map((a) => a.path);
    expect(changed.sort()).toEqual([
      '.claude/skills/forgecms-admin',
      '.claude/skills/forgecms-setup'
    ]);
    expect(read(root, '.claude/skills/forgecms-admin/SKILL.md')).toContain('name: forgecms-admin');
  });

  it('a corrupt stamp counts as ours only with --force', () => {
    const root = project();
    install({ root, targets: ['claude'] });
    writeFileSync(join(root, '.claude/skills/forgecms-setup', SKILL_STAMP), 'not json');
    const report = install({ root, targets: ['claude'] });
    expect(report.actions.find((a) => a.path.endsWith('forgecms-setup'))?.status).toBe('conflict');
  });

  it('a stamp that is valid JSON but not an object is treated as an empty stamp', () => {
    const root = project();
    install({ root, targets: ['claude'] });
    writeFileSync(join(root, '.claude/skills/forgecms-setup', SKILL_STAMP), '5');
    const report = install({ root, targets: ['claude'] });
    expect(report.actions.find((a) => a.path.endsWith('forgecms-setup'))?.status).toBe('update');
  });

  it('--dry-run reports the plan and writes nothing', () => {
    const root = project();
    const report = install({ root, targets: ['claude', 'agents'], dryRun: true });
    expect(new Set(statuses(report))).toEqual(new Set(['create']));
    expect(existsSync(join(root, MCP_CONFIG_FILE))).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.agents'))).toBe(false);
  });

  it('honours an explicit package manager', () => {
    const root = project({ 'pnpm-lock.yaml': '' });
    install({ root, targets: [], packageManager: 'npm' });
    expect(JSON.parse(read(root, MCP_CONFIG_FILE)).mcpServers['forge-cms'].command).toBe('npx');
  });

  it('writes the secret-free config only: no env, token or path', () => {
    const root = project({ '.env': 'AUTH_SECRET=sk_live_abc' });
    install({ root, targets: ['claude'] });
    expect(read(root, MCP_CONFIG_FILE)).not.toMatch(/sk_live|AUTH_SECRET|\/Users|\/home/);
  });

  it('never writes outside the project through a symlinked skills directory or .mcp.json', () => {
    const root = project();
    const outside = project();
    mkdirSync(join(root, '.claude'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/skills'));
    symlinkSync(join(outside, 'stolen.json'), join(root, MCP_CONFIG_FILE));
    const report = install({ root, targets: ['claude'] });
    expect(new Set(statuses(report))).toEqual(new Set(['conflict']));
    expect(existsSync(join(outside, 'forgecms-setup'))).toBe(false);
    expect(existsSync(join(outside, 'stolen.json'))).toBe(false);
  });
});

describe('check', () => {
  it('is not ok on a fresh project, ok after init, not ok again when stale', () => {
    const root = project();
    expect(check({ root, targets: ['claude'] }).ok).toBe(false);
    expect(existsSync(join(root, MCP_CONFIG_FILE))).toBe(false);
    install({ root, targets: ['claude'] });
    expect(check({ root, targets: ['claude'] }).ok).toBe(true);
    writeFileSync(join(root, '.claude/skills/forgecms-setup', SKILL_STAMP), '{"version":"0"}');
    expect(check({ root, targets: ['claude'] }).ok).toBe(false);
  });
});
