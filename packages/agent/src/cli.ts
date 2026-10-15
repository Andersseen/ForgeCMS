import { resolve } from 'node:path';
import {
  check,
  install,
  type InstallAction,
  type InstallReport,
  type PackageManager,
  type SkillTarget
} from './install.js';

export const USAGE = `forge-cms-agent <command> [options]   (EXPERIMENTAL development tooling)

Commands
  init     Connect your coding agent: writes the MCP entry to .mcp.json and copies the skills into the project.
           Idempotent; \`sync\` is an alias to run after upgrading ForgeCMS.
  check    Report what init would change; exit 1 if anything is missing or stale (CI-friendly). Writes nothing.

Options
  --root <dir>             Project directory (default: the current directory)
  --target <list>          Where skills go: claude, agents or claude,agents (default: claude)
  --package-manager <pm>   pnpm | npm | yarn | bun (default: detected from the lockfile)
  --dry-run                Show the plan; change nothing
  --force                  Replace a differing MCP entry or a skill directory this tool did not create
  -h, --help               Show this help

Only files inside the project are written. No credential is read or needed; no network request is made.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Parsed {
  command: string | undefined;
  root: string;
  targets: SkillTarget[];
  packageManager?: PackageManager;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

const TARGETS: SkillTarget[] = ['claude', 'agents'];
const MANAGERS: PackageManager[] = ['pnpm', 'npm', 'yarn', 'bun'];

export function parseArgs(argv: string[], cwd: string): Parsed {
  const parsed: Parsed = {
    command: undefined,
    root: cwd,
    targets: ['claude'],
    dryRun: false,
    force: false,
    help: false
  };
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--root') parsed.root = resolve(cwd, value(i++, arg));
    else if (arg === '--target') {
      const list = value(i++, arg).split(',');
      const bad = list.find((item) => !TARGETS.includes(item as SkillTarget));
      if (bad !== undefined) throw new Error(`unknown --target "${bad}" (use claude, agents)`);
      parsed.targets = [...new Set(list)] as SkillTarget[];
    } else if (arg === '--package-manager') {
      const manager = value(i++, arg);
      if (!MANAGERS.includes(manager as PackageManager))
        throw new Error(`unknown --package-manager "${manager}"`);
      parsed.packageManager = manager as PackageManager;
    } else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else if (parsed.command === undefined) parsed.command = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  return parsed;
}

const MARK: Record<InstallAction['status'], string> = {
  create: '+ create   ',
  update: '~ update   ',
  unchanged: '= unchanged',
  conflict: '! conflict '
};

function printReport(io: CliIo, report: InstallReport, dryRun: boolean): void {
  io.out(`ForgeCMS Agent Kit ${report.version}${dryRun ? ' (dry run - nothing written)' : ''}`);
  for (const action of report.actions) {
    io.out(`  ${MARK[action.status]} ${action.path}${action.detail ? ` - ${action.detail}` : ''}`);
  }
}

/** Runs the CLI and returns the process exit code. Pure apart from the project files it is asked to write. */
export function runCli(argv: string[], io: CliIo, cwd: string = process.cwd()): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv, cwd);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help || parsed.command === undefined) {
    io.out(USAGE);
    return parsed.help ? 0 : 2;
  }
  const options = {
    root: parsed.root,
    targets: parsed.targets,
    force: parsed.force,
    ...(parsed.packageManager !== undefined && { packageManager: parsed.packageManager })
  };
  try {
    if (parsed.command === 'check') {
      const { ok, report } = check(options);
      printReport(io, report, true);
      io.out(ok ? 'Up to date.' : 'Not up to date: run `pnpm exec forge-cms-agent init`.');
      return ok ? 0 : 1;
    }
    if (parsed.command === 'init' || parsed.command === 'sync') {
      const report = install({ ...options, dryRun: parsed.dryRun });
      printReport(io, report, parsed.dryRun);
      const conflicts = report.actions.filter((action) => action.status === 'conflict');
      io.out(
        `\nCodex reads ~/.codex/config.toml (outside the project, so it is never written). Add:\n\n${report.codexSnippet}`
      );
      if (conflicts.length > 0) {
        io.err(
          `\n${conflicts.length} conflict(s) left untouched (see above); use --force to replace.`
        );
        return 1;
      }
      return 0;
    }
    io.err(`unknown command "${parsed.command}"\n\n${USAGE}`);
    return 2;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
