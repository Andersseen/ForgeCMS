import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS_DIR, packageVersion } from './package-info.js';

/** Where an agent reads project skills. Both are inside the project; nothing outside it is ever written. */
export type SkillTarget = 'claude' | 'agents';
export const SKILL_TARGET_DIRS: Record<SkillTarget, string> = {
  claude: '.claude/skills',
  agents: '.agents/skills'
};
export const MCP_CONFIG_FILE = '.mcp.json';
export const MCP_SERVER_NAME = 'forge-cms';
/** Written inside each installed skill directory: proves the directory is ours and records its version. */
export const SKILL_STAMP = '.forge-cms-agent.json';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export type ActionStatus = 'create' | 'update' | 'unchanged' | 'conflict';
export interface InstallAction {
  kind: 'mcp' | 'skill';
  /** Project-relative path. */
  path: string;
  status: ActionStatus;
  detail?: string;
}

export interface InstallOptions {
  root: string;
  targets: SkillTarget[];
  /** Overwrite a conflicting MCP entry or a skill directory that this tool did not create. */
  force?: boolean;
  /** Report only; touch nothing. */
  dryRun?: boolean;
  /** Overrides lockfile detection. */
  packageManager?: PackageManager;
}

export interface InstallReport {
  version: string;
  actions: InstallAction[];
  /** Config the tool cannot write for the user (Codex reads `~/.codex/config.toml`, outside the project). */
  codexSnippet: string;
}

interface McpEntry {
  command: string;
  args: string[];
}

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml')) || existsSync(join(root, 'pnpm-workspace.yaml')))
    return 'pnpm';
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

/** The command that starts the locally installed MCP binary with the project's own package manager. */
export function mcpEntryFor(manager: PackageManager): McpEntry {
  switch (manager) {
    case 'npm':
      return { command: 'npx', args: ['--no-install', 'forge-cms-mcp'] };
    case 'yarn':
      return { command: 'yarn', args: ['forge-cms-mcp'] };
    case 'bun':
      return { command: 'bunx', args: ['forge-cms-mcp'] };
    default:
      return { command: 'pnpm', args: ['exec', 'forge-cms-mcp'] };
  }
}

export function codexSnippet(entry: McpEntry): string {
  return `[mcp_servers.${MCP_SERVER_NAME}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`;
}

function sameEntry(value: unknown, entry: McpEntry): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['command'] === entry.command &&
    JSON.stringify(candidate['args']) === JSON.stringify(entry.args)
  );
}

/** The bundled skills (directories holding a SKILL.md), sorted. */
export function bundledSkills(dir: URL = SKILLS_DIR): string[] {
  const base = fileURLToPath(dir);
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function readStamp(skillDir: string): { version?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(skillDir, SKILL_STAMP), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as { version?: string }) : {};
  } catch {
    return undefined;
  }
}

function skillContentEquals(source: string, installed: string): boolean {
  try {
    return (
      readFileSync(join(source, 'SKILL.md'), 'utf8') ===
      readFileSync(join(installed, 'SKILL.md'), 'utf8')
    );
  } catch {
    return false;
  }
}

/** Whether `rel` (or any parent below the root) is a symlink: such a path could lead outside the project. */
function crossesSymlink(root: string, rel: string): boolean {
  let current = root;
  for (const part of rel.split('/')) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Plans (and, unless `dryRun`, applies) the MCP entry and the skills. Idempotent: a second run reports `unchanged`. */
export function install(options: InstallOptions): InstallReport {
  const version = packageVersion();
  const manager = options.packageManager ?? detectPackageManager(options.root);
  const entry = mcpEntryFor(manager);
  const apply = options.dryRun !== true;
  const actions: InstallAction[] = [];

  actions.push(planMcp(options, entry, apply));
  const skillsBase = fileURLToPath(SKILLS_DIR);
  for (const target of options.targets) {
    for (const name of bundledSkills()) {
      actions.push(planSkill(options, target, name, join(skillsBase, name), version, apply));
    }
  }
  return { version, actions, codexSnippet: codexSnippet(entry) };
}

function planMcp(options: InstallOptions, entry: McpEntry, apply: boolean): InstallAction {
  const path = join(options.root, MCP_CONFIG_FILE);
  if (crossesSymlink(options.root, MCP_CONFIG_FILE)) {
    return {
      kind: 'mcp',
      path: MCP_CONFIG_FILE,
      status: 'conflict',
      detail: `${MCP_CONFIG_FILE} is a symlink; it is never written through`
    };
  }
  let config: Record<string, unknown> = {};
  const existed = existsSync(path);
  if (existed) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      config = parsed as Record<string, unknown>;
    } catch {
      return {
        kind: 'mcp',
        path: MCP_CONFIG_FILE,
        status: 'conflict',
        detail: `${MCP_CONFIG_FILE} is not a JSON object; fix it by hand (it is never overwritten)`
      };
    }
  }
  const servers =
    typeof config['mcpServers'] === 'object' &&
    config['mcpServers'] !== null &&
    !Array.isArray(config['mcpServers'])
      ? (config['mcpServers'] as Record<string, unknown>)
      : {};
  const current = servers[MCP_SERVER_NAME];
  if (sameEntry(current, entry)) return { kind: 'mcp', path: MCP_CONFIG_FILE, status: 'unchanged' };
  if (current !== undefined && options.force !== true) {
    return {
      kind: 'mcp',
      path: MCP_CONFIG_FILE,
      status: 'conflict',
      detail: `an existing "${MCP_SERVER_NAME}" entry differs; re-run with --force to replace it`
    };
  }
  if (apply) {
    writeFileSync(
      path,
      `${JSON.stringify({ ...config, mcpServers: { ...servers, [MCP_SERVER_NAME]: entry } }, null, 2)}\n`
    );
  }
  return {
    kind: 'mcp',
    path: MCP_CONFIG_FILE,
    status: current === undefined ? 'create' : 'update'
  };
}

function planSkill(
  options: InstallOptions,
  target: SkillTarget,
  name: string,
  source: string,
  version: string,
  apply: boolean
): InstallAction {
  const relative = `${SKILL_TARGET_DIRS[target]}/${name}`;
  const destination = join(options.root, ...relative.split('/'));
  if (crossesSymlink(options.root, relative)) {
    return {
      kind: 'skill',
      path: relative,
      status: 'conflict',
      detail: 'a path component is a symlink; nothing is written through it'
    };
  }
  if (existsSync(destination)) {
    if (!lstatSync(destination).isDirectory()) {
      return { kind: 'skill', path: relative, status: 'conflict', detail: 'not a directory' };
    }
    const stamp = readStamp(destination);
    if (stamp === undefined && options.force !== true) {
      return {
        kind: 'skill',
        path: relative,
        status: 'conflict',
        detail: 'exists and was not installed by forge-cms-agent; re-run with --force to replace it'
      };
    }
    if (stamp?.version === version && skillContentEquals(source, destination)) {
      return { kind: 'skill', path: relative, status: 'unchanged' };
    }
    if (apply) copySkill(source, destination, version);
    return { kind: 'skill', path: relative, status: 'update' };
  }
  if (apply) copySkill(source, destination, version);
  return { kind: 'skill', path: relative, status: 'create' };
}

function copySkill(source: string, destination: string, version: string): void {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
  writeFileSync(join(destination, SKILL_STAMP), `${JSON.stringify({ version })}\n`);
}

/** Whether the project is fully set up (`ok`) and every action that is still needed. Never writes. */
export function check(options: InstallOptions): { ok: boolean; report: InstallReport } {
  const report = install({ ...options, dryRun: true });
  return { ok: report.actions.every((action) => action.status === 'unchanged'), report };
}
