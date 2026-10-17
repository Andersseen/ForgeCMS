// Agent Kit smoke against the REAL registry package (roadmap L02). Experimental support label respected: this proves
// install, the two binaries, `init --dry-run`/`init`/`check`/`sync`, that user configuration is preserved, that nothing
// is overwritten or written outside the project without the documented flag, and a read-only MCP handshake.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REGISTRY_NPMRC, installedProblems, registrySpecs, workspaceProblems } from './lib.mjs';
import { repoRoot } from '../docs/shared.mjs';

const fail = (message) => {
  throw new Error(`agent kit (registry): ${message}`);
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};

const REQUIRED_TOOLS = [
  'forge_docs_search',
  'forge_project_detect',
  'forge_project_doctor',
  'forge_runtime_metadata',
  'forge_support'
];

function sh(command, args, cwd, { allowFailure = false } = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  if (!allowFailure && result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

export async function verifyAgentRegistry({ workDir, version, reportDir }) {
  const project = join(workDir, 'agent');
  mkdirSync(project, { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), 'forge-agent-outside-'));
  const sdk = execFileSync(
    'npm',
    ['view', `@forge-cms/agent@${version}`, 'dependencies.@modelcontextprotocol/sdk'],
    {
      encoding: 'utf8'
    }
  ).trim();
  const forge = registrySpecs(['@forge-cms/core', '@forge-cms/agent'], version);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'forge-registry-agent-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { '@forge-cms/core': forge['@forge-cms/core'] },
        devDependencies: {
          '@forge-cms/agent': forge['@forge-cms/agent'],
          '@modelcontextprotocol/sdk': sdk
        },
        pnpm: { overrides: forge }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(project, '.npmrc'), REGISTRY_NPMRC);
  // pnpm-lock.yaml makes the lockfile the install record; a lockfile in `pnpm install` output is asserted below.
  sh('pnpm', ['install'], project);
  const problems = [
    ...workspaceProblems(project, repoRoot),
    ...installedProblems(project, { version, names: ['@forge-cms/core', '@forge-cms/agent'] })
  ];
  expect(problems.length === 0, `install is not clean:\n  - ${problems.join('\n  - ')}`);
  for (const bin of ['forge-cms-agent', 'forge-cms-mcp']) {
    expect(existsSync(join(project, 'node_modules', '.bin', bin)), `bin ${bin} is not linked`);
  }
  console.log(`  ✓ @forge-cms/agent@${version} installed from the registry; both binaries linked`);

  // A project with existing user configuration and secrets.
  const secret = 'sk_live_REGISTRY_AGENT_SECRET';
  writeFileSync(join(project, '.env'), `AUTH_SECRET=${secret}\n`);
  const userMcp = {
    mcpServers: { 'my-own-server': { command: 'node', args: ['mine.js'] } },
    someUserKey: { keep: true }
  };
  writeFileSync(join(project, '.mcp.json'), `${JSON.stringify(userMcp, null, 2)}\n`);
  mkdirSync(join(project, '.claude/skills/my-custom-skill'), { recursive: true });
  writeFileSync(join(project, '.claude/skills/my-custom-skill/SKILL.md'), '# mine\n');
  // A user-made folder that collides with an official skill name: must be refused without --force.
  mkdirSync(join(project, '.claude/skills/forgecms-admin'), { recursive: true });
  writeFileSync(join(project, '.claude/skills/forgecms-admin/SKILL.md'), '# USER OWNED\n');

  const cli = (args, opts) => sh('pnpm', ['exec', 'forge-cms-agent', ...args], project, opts);
  const snapshot = () =>
    JSON.stringify(
      readdirSync(project, { recursive: true })
        .filter((f) => !String(f).startsWith('node_modules'))
        .sort()
    );

  // check before init: exit 1, writes nothing.
  const before = snapshot();
  expect(cli(['check'], { allowFailure: true }).status === 1, 'check must exit 1 before init');
  expect(snapshot() === before, 'check wrote something');

  // --dry-run writes nothing.
  const dry = cli(['init', '--dry-run'], { allowFailure: true });
  expect(
    dry.status === 1 && /conflict/.test(dry.out),
    `--dry-run must report the conflict and exit 1:\n${dry.out}`
  );
  expect(snapshot() === before, '--dry-run wrote something');
  expect(/mcp/i.test(dry.out), '--dry-run did not describe the plan');

  // Real init without --force: user config preserved, the colliding user folder refused (not overwritten).
  const init = cli(['init'], { allowFailure: true });
  const mcp = JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8'));
  expect(mcp.mcpServers['my-own-server']?.command === 'node', 'init removed the user MCP server');
  expect(mcp.someUserKey?.keep === true, 'init removed an unrelated user key');
  const entry = mcp.mcpServers['forge-cms'];
  expect(
    entry?.command === 'pnpm' && JSON.stringify(entry.args) === '["exec","forge-cms-mcp"]',
    `unexpected forge-cms entry ${JSON.stringify(entry)}`
  );
  expect(
    readFileSync(join(project, '.claude/skills/my-custom-skill/SKILL.md'), 'utf8') === '# mine\n',
    'custom skill touched'
  );
  expect(
    readFileSync(join(project, '.claude/skills/forgecms-admin/SKILL.md'), 'utf8') ===
      '# USER OWNED\n',
    'init overwrote a user-owned skill folder without --force'
  );
  expect(
    init.status === 1 && /conflict/.test(init.out) && /--force/.test(init.out),
    `init did not report the refused folder:\n${init.out}`
  );
  expect(
    readFileSync(join(project, '.env'), 'utf8') === `AUTH_SECRET=${secret}\n`,
    'init touched .env'
  );
  expect(
    !readFileSync(join(project, '.mcp.json'), 'utf8').includes(secret),
    'a secret reached .mcp.json'
  );
  console.log(
    '  ✓ init: user MCP entries/keys and custom skills preserved; a colliding user folder is refused without --force'
  );

  // --force replaces only the collision; then check is green and a second init is a no-op.
  cli(['init', '--force']);
  expect(
    readFileSync(join(project, '.claude/skills/forgecms-admin/SKILL.md'), 'utf8') !==
      '# USER OWNED\n',
    '--force did not replace'
  );
  expect(cli(['check'], { allowFailure: true }).status === 0, 'check must exit 0 after init');
  expect(!/\+ create|~ update/.test(cli(['init']).out), 'a second init changed something');

  // sync repairs a stale skill.
  execFileSync('rm', ['-rf', join(project, '.claude/skills/forgecms-setup')]);
  expect(cli(['check'], { allowFailure: true }).status === 1, 'check must flag a missing skill');
  cli(['sync']);
  expect(cli(['check'], { allowFailure: true }).status === 0, 'sync did not repair the skill');
  console.log('  ✓ check/sync/idempotency');

  // Symlink escape: a symlinked skills directory pointing outside must never be written through.
  const escape = join(workDir, 'agent-escape');
  mkdirSync(join(escape, '.agents'), { recursive: true });
  writeFileSync(join(escape, 'package.json'), readFileSync(join(project, 'package.json')));
  symlinkSync(outside, join(escape, '.agents', 'skills'));
  const nm = join(escape, 'node_modules');
  symlinkSync(join(project, 'node_modules'), nm);
  const escaped = spawnSync('pnpm', ['exec', 'forge-cms-agent', 'init', '--target', 'agents'], {
    cwd: escape,
    encoding: 'utf8',
    env: process.env
  });
  expect(
    readdirSync(outside).length === 0,
    `init wrote through a symlink to ${outside}: ${readdirSync(outside)}`
  );
  expect(lstatSync(join(escape, '.agents', 'skills')).isSymbolicLink(), 'the symlink was replaced');
  console.log(
    `  ✓ symlink escape refused (exit ${escaped.status}); nothing written outside the project`
  );

  // Read-only MCP handshake over stdio with discovery.
  writeFileSync(
    join(project, 'probe.mjs'),
    `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'registry-probe', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'pnpm', args: ['exec', 'forge-cms-mcp'], cwd: process.cwd(), stderr: 'inherit' }));
const json = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const out = {
  server: client.getServerVersion(),
  tools: (await client.listTools()).tools.map((t) => t.name).sort(),
  readOnly: (await client.listTools()).tools.every((t) => !t.annotations || t.annotations.readOnlyHint !== false),
  resources: (await client.listResources()).resources.map((r) => r.uri),
  detect: await json('forge_project_detect'),
  support: await json('forge_support'),
  docs: await json('forge_docs_search', { query: 'first admin bootstrap' }),
  traversal: (await client.callTool({ name: 'forge_project_detect', arguments: { path: '../../.env' } })).content[0].text
};
await client.close();
console.log(JSON.stringify(out));
`
  );
  const probe = sh('node', ['probe.mjs'], project);
  const result = JSON.parse(probe.out.trim().split('\n').at(-1));
  expect(
    result.server?.name === 'forge-cms' && result.server.version === version,
    `server identity ${JSON.stringify(result.server)}`
  );
  expect(JSON.stringify(result.tools) === JSON.stringify(REQUIRED_TOOLS), `tools: ${result.tools}`);
  expect(result.readOnly, 'a tool is not read-only');
  expect(result.resources.includes('forge://support'), 'forge://support missing');
  expect(
    result.detect.forgePackages['@forge-cms/core']?.installed === version,
    'installed core version not detected'
  );
  expect(result.support.forgeVersion === version, 'support facts version');
  expect(result.docs.version === version && result.docs.results.length > 0, 'docs search');
  const everything = JSON.stringify(result);
  expect(
    !everything.includes(secret) && !result.traversal.includes('root:'),
    'secret or foreign file leaked via MCP'
  );
  console.log(
    `  ✓ MCP: ${result.tools.length} read-only tools, ${result.resources.length} resources, docs matched to ${version}, no secret leaked`
  );
  if (reportDir) {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, 'agent.pnpm-lock.yaml'),
      readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8')
    );
  }
}
