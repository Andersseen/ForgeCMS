#!/usr/bin/env node
// Packed external consumer of `@forge-cms/agent` (spec 093). `release:certify` stage `agent`.
//
// From the EXACT packed tarballs (never workspace links) in a clean temporary project:
//   - install `@forge-cms/agent` (+ `@forge-cms/core`, so an installed Forge version can be detected);
//   - launch the MCP server through the package binary (`pnpm exec forge-cms-mcp`) over real stdio;
//   - handshake, list tools/resources, call project detection, docs search, support and the doctor;
//   - inspect the packed assets (skills, docs corpus, bin) and refuse anything that must not ship.
// Exits non-zero on any problem. Publishes nothing, touches no remote resource.
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTarballs } from './certification/artifacts.mjs';

const keep = process.argv.includes('--keep');
const REQUIRED_SKILLS = [
  'forgecms-admin',
  'forgecms-analytics',
  'forgecms-auth-access',
  'forgecms-cloudflare',
  'forgecms-content-modeling',
  'forgecms-localization',
  'forgecms-migrations-recovery',
  'forgecms-setup'
];
const REQUIRED_TOOLS = [
  'forge_docs_search',
  'forge_project_detect',
  'forge_project_doctor',
  'forge_runtime_metadata',
  'forge_support'
];
const FORBIDDEN_IN_TARBALL = [
  /^src\//,
  /\.test\.(js|ts)$/,
  /(^|\/)test-support\./,
  /(^|\/)\.agents\//,
  /(^|\/)\.claude\//,
  /(^|\/)\.codex\//,
  /(^|\/)\.env/,
  /^tsconfig/
];

const fail = (message) => {
  throw new Error(`agent kit: ${message}`);
};
const run = (command, args, cwd) => {
  console.log(`$ ${[command, ...args].join(' ')}`);
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, CI: 'true' }
  });
};

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-agent-'));
try {
  const tarballs = resolveTarballs(
    join(workDir, 'packs'),
    ['@forge-cms/core', '@forge-cms/agent'],
    {
      log: (line) => console.log(line)
    }
  );
  const agentPackage = JSON.parse(
    execFileSync(
      'tar',
      ['-xzOf', tarballs['@forge-cms/agent'].slice('file:'.length), 'package/package.json'],
      { encoding: 'utf8' }
    )
  );

  // Tarball contents
  const listing = execFileSync(
    'tar',
    ['-tzf', tarballs['@forge-cms/agent'].slice('file:'.length)],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter((line) => line && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));
  for (const file of listing) {
    if (FORBIDDEN_IN_TARBALL.some((pattern) => pattern.test(file)))
      fail(`the tarball ships ${file}`);
  }
  for (const required of [
    'README.md',
    'dist/index.js',
    'dist/bin.js',
    'docs/index.json',
    ...REQUIRED_SKILLS.map((name) => `skills/${name}/SKILL.md`)
  ]) {
    if (!listing.includes(required)) fail(`the tarball is missing ${required}`);
  }
  if (agentPackage.bin?.['forge-cms-mcp'] !== './dist/bin.js')
    fail('the forge-cms-mcp bin is not declared');
  if (
    Object.values({ ...agentPackage.dependencies, ...agentPackage.peerDependencies }).some(
      (range) => /^(workspace|catalog|link|file):/.test(String(range))
    )
  ) {
    fail('the packed manifest has unresolved workspace specifiers');
  }
  if (Object.keys(agentPackage.dependencies ?? {}).some((name) => name.startsWith('@forge-cms/'))) {
    fail('the agent kit must not depend on other Forge packages at runtime');
  }

  // A clean project that installs ONLY packed tarballs (+ the MCP client SDK to drive the server).
  const project = join(workDir, 'consumer');
  mkdirSync(project, { recursive: true });
  const sdk = agentPackage.dependencies['@modelcontextprotocol/sdk'];
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'forge-agent-consumer',
        private: true,
        type: 'module',
        dependencies: { '@forge-cms/core': tarballs['@forge-cms/core'] },
        devDependencies: {
          '@forge-cms/agent': tarballs['@forge-cms/agent'],
          '@modelcontextprotocol/sdk': sdk
        }
      },
      null,
      2
    )}\n`
  );
  // pnpm needs the lockfile-less install to be allowed to resolve the tarball set.
  run('pnpm', ['install', '--prefer-offline', '--ignore-workspace'], project);

  const installed = join(project, 'node_modules', '@forge-cms', 'agent');
  if (!realpathSync(installed).startsWith(realpathSync(project)))
    fail('the agent package resolves outside the clean project (a workspace link?)');
  if (
    lstatSync(join(project, 'node_modules', '.bin', 'forge-cms-mcp'), { throwIfNoEntry: false }) ===
    undefined
  ) {
    fail('pnpm did not link the forge-cms-mcp binary');
  }
  const skills = readdirSync(join(installed, 'skills')).sort();
  if (JSON.stringify(skills) !== JSON.stringify(REQUIRED_SKILLS))
    fail(`installed skills differ: ${skills.join(', ')}`);

  // The consumer project: a localized Angular/Analog client site with analytics, and secrets lying around.
  const secret = 'sk_live_PACKED_CONSUMER_SECRET';
  mkdirSync(join(project, 'src/app'), { recursive: true });
  writeFileSync(join(project, '.env'), `AUTH_SECRET=${secret}\n`);
  writeFileSync(
    join(project, 'src/app/app.config.ts'),
    "import { provideRouter } from '@angular/router';\nimport { provideForgeAnalytics } from '@forge-cms/angular';\nexport const c = [provideRouter([]), provideForgeAnalytics({ enabled: true })];\n"
  );
  writeFileSync(
    join(project, 'src/collections.ts'),
    "export const x = { locales: ['es', 'en'], fields: { title: { localized: true } } };\n"
  );
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  manifest.dependencies['@forge-cms/angular'] = agentPackage.version;
  manifest.dependencies['@angular/core'] = '21.2.10';
  writeFileSync(join(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  writeFileSync(
    join(project, 'probe.mjs'),
    `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const out = {};
const transport = new StdioClientTransport({ command: 'pnpm', args: ['exec', 'forge-cms-mcp'], cwd: process.cwd(), stderr: 'inherit' });
const client = new Client({ name: 'forge-agent-probe', version: '0.0.0' });
await client.connect(transport);
const json = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
out.server = client.getServerVersion();
out.tools = (await client.listTools()).tools.map((t) => t.name).sort();
out.resources = (await client.listResources()).resources.map((r) => r.uri);
out.detect = await json('forge_project_detect');
out.doctor = await json('forge_project_doctor');
out.support = await json('forge_support');
out.loc = await json('forge_docs_search', { query: 'localized Spanish English title' });
out.analytics = await json('forge_docs_search', { query: 'enable analytics in the admin' });
out.traversal = (await client.callTool({ name: 'forge_project_detect', arguments: { path: '../../.env' } })).content[0].text;
await client.close();
console.log(JSON.stringify(out));
`
  );
  const result = JSON.parse(run('node', ['probe.mjs'], project).trim().split('\n').at(-1));

  const expect = (condition, message) => {
    if (!condition) fail(message);
  };
  expect(
    result.server?.name === 'forge-cms' && result.server.version === agentPackage.version,
    `server identity ${JSON.stringify(result.server)}`
  );
  expect(JSON.stringify(result.tools) === JSON.stringify(REQUIRED_TOOLS), `tools: ${result.tools}`);
  for (const uri of [
    'forge://support',
    'forge://project',
    'forge://docs/quickstart',
    'forge://docs/analytics',
    'forge://skills/forgecms-localization'
  ]) {
    expect(result.resources.includes(uri), `missing resource ${uri}`);
  }
  expect(
    result.detect.forgePackages['@forge-cms/core']?.installed === agentPackage.version,
    'installed @forge-cms/core version not detected'
  );
  expect(result.detect.framework.angular === '21.2.10', 'Angular version not detected');
  expect(
    result.detect.localization.detected === true && result.detect.analytics.tracker === true,
    'localization/analytics not detected'
  );
  expect(
    result.support.forgeVersion === agentPackage.version &&
      result.support.analytics.status === 'experimental',
    'support facts'
  );
  expect(
    result.loc.results.some((hit) => /localized: true/.test(hit.excerpt)) &&
      result.loc.version === agentPackage.version,
    'localization docs not found'
  );
  expect(result.analytics.results.length > 0, 'analytics docs not found');
  expect(Array.isArray(result.doctor.checks), 'doctor returned no checks');
  const everything = JSON.stringify(result);
  expect(
    !everything.includes(secret) &&
      !everything.includes('AUTH_SECRET=') &&
      !result.traversal.includes('root:'),
    'a secret or foreign file leaked through the MCP'
  );
  console.log(
    `  ✓ agent kit ${agentPackage.version}: packed tarball installs in a clean project, stdio handshake, ${result.tools.length} tools, ${result.resources.length} resources, ${skills.length} skills, no secret leaked`
  );
  console.log('\nPacked Agent Kit consumer passed.');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
