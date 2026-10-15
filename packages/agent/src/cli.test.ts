import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs, runCli } from './cli.js';
import { makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
function project(): string {
  const made = makeProject({ 'package.json': { name: 'site' } });
  cleanups.push(made.cleanup);
  return made.root;
}
function run(argv: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) }, cwd);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('parseArgs', () => {
  it('parses commands and options', () => {
    const parsed = parseArgs(
      ['init', '--root', 'sub', '--target', 'claude,agents,claude', '--dry-run', '--force'],
      '/work'
    );
    expect(parsed).toMatchObject({
      command: 'init',
      root: '/work/sub',
      targets: ['claude', 'agents'],
      dryRun: true,
      force: true
    });
    expect(parseArgs(['init', '--package-manager', 'yarn'], '/w').packageManager).toBe('yarn');
    expect(parseArgs(['-h'], '/w').help).toBe(true);
  });
  it('rejects bad input', () => {
    for (const bad of [
      ['init', '--root'],
      ['init', '--root', '--force'],
      ['init', '--target', 'vim'],
      ['init', '--package-manager', 'cargo'],
      ['init', '--nope'],
      ['init', 'extra']
    ]) {
      expect(() => parseArgs(bad, '/w')).toThrow();
    }
  });
});

describe('runCli', () => {
  it('prints usage: 0 for --help, 2 without a command or on bad input', () => {
    expect(run(['--help'], '/tmp').code).toBe(0);
    expect(run([], '/tmp').code).toBe(2);
    const bad = run(['init', '--target', 'vim'], '/tmp');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown --target');
    const unknown = run(['frobnicate'], '/tmp');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown command');
  });

  it('init writes the config and skills, and prints the Codex snippet instead of writing it', () => {
    const root = project();
    const result = run(['init'], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain('+ create');
    expect(result.out).toContain('[mcp_servers.forge-cms]');
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.claude/skills/forgecms-setup/SKILL.md'))).toBe(true);
    const second = run(['sync'], root);
    expect(second.code).toBe(0);
    expect(second.out).toContain('= unchanged');
  });

  it('--dry-run writes nothing; --target agents writes .agents/skills only', () => {
    const root = project();
    expect(run(['init', '--dry-run'], root).out).toContain('dry run');
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    run(['init', '--target', 'agents'], root);
    expect(existsSync(join(root, '.agents/skills/forgecms-setup/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('conflicts exit 1 and leave the file untouched', () => {
    const root = project();
    const config = JSON.stringify({ mcpServers: { 'forge-cms': { command: 'x', args: [] } } });
    run(['init', '--target', 'agents'], root);
    writeFileSync(join(root, '.mcp.json'), config);
    const result = run(['init', '--target', 'agents'], root);
    expect(result.code).toBe(1);
    expect(result.err).toContain('conflict');
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(config);
    expect(run(['init', '--target', 'agents', '--force'], root).code).toBe(0);
  });

  it('check exits 1 until initialised, then 0, and never writes', () => {
    const root = project();
    const before = run(['check'], root);
    expect(before.code).toBe(1);
    expect(before.out).toContain('Not up to date');
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    run(['init'], root);
    const after = run(['check'], root);
    expect(after.code).toBe(0);
    expect(after.out).toContain('Up to date.');
  });

  it('an unreadable root is a clean error, not a stack trace', () => {
    const result = run(['init', '--root', '/definitely/not/here'], '/tmp');
    expect(result.code).toBe(1);
    expect(result.err.length).toBeGreaterThan(0);
  });
});
