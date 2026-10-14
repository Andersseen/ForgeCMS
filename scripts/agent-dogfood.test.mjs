// Spec 094: the Agent Kit as DEVELOPMENT tooling against a real consumer. Launches the built local MCP
// server (stdio, read-only) with `--root apps/demo-aesthetics` and asserts it understands the Lumea project.
// Deterministic: no LLM, no network, no remote service. `@forge-cms/agent` is never a dependency of the demo
// (scripts/agent-boundary.test.mjs enforces that); the probe borrows the MCP client from packages/agent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const agentDir = resolve('packages/agent');
const bin = join(agentDir, 'dist', 'bin.js');
const demo = resolve('apps/demo-aesthetics');

const probe = `
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [bin, root] = process.argv.slice(2);
const transport = new StdioClientTransport({ command: process.execPath, args: [bin, '--root', root], stderr: 'ignore' });
const client = new Client({ name: 'lumea-dogfood', version: '0.0.0' });
await client.connect(transport);
const json = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const out = {
  tools: (await client.listTools()).tools.map((t) => t.name).sort(),
  detect: await json('forge_project_detect'),
  doctor: await json('forge_project_doctor'),
  search: await json('forge_docs_search', { query: 'localized Spanish English title' })
};
await client.close();
process.stdout.write('\\n' + JSON.stringify(out));
`;

test(
  'the Agent Kit detects and checks the Lumea demo project',
  { skip: existsSync(bin) ? false : 'packages/agent is not built (run pnpm build)' },
  () => {
    // The probe is written inside packages/agent (removed afterwards) so it resolves the MCP client from
    // that package's own dependencies, which is how the kit is meant to be used.
    const file = join(agentDir, `.dogfood-probe-${process.pid}.mjs`);
    try {
      writeFileSync(file, probe);
      const stdout = execFileSync(process.execPath, [file, bin, demo], {
        cwd: agentDir,
        encoding: 'utf8',
        timeout: 60_000
      });
      const result = JSON.parse(stdout.slice(stdout.lastIndexOf('\n') + 1));

      // Read-only surface: nothing that writes, runs or deploys.
      assert.ok(result.tools.includes('forge_project_detect'));
      assert.ok(result.tools.every((tool) => tool.startsWith('forge_')));
      assert.ok(
        !result.tools.some((tool) => /(^|_)(write|deploy|exec|run|mutate|delete)(_|$)/.test(tool))
      );

      const { detect } = result;
      for (const name of ['core', 'runtime', 'angular', 'admin', 'cloudflare']) {
        assert.ok(detect.forgePackages[`@forge-cms/${name}`], `${name} not detected`);
      }
      assert.match(detect.framework.angular, /^21\./);
      assert.ok(detect.framework.analog, 'Analog not detected');
      assert.ok(detect.framework.vite, 'Vite not detected');
      assert.equal(detect.detectedProfile, 'cloudflare');
      assert.deepEqual(detect.wrangler.bindings.d1, ['DB']);
      assert.deepEqual(detect.wrangler.bindings.r2, ['BUCKET']);
      assert.equal(detect.admin.detected, true);
      assert.equal(detect.localization.detected, true);
      assert.equal(detect.analytics.tracker, true);
      assert.equal(detect.analytics.adminRoute, true);
      assert.equal(detect.analytics.collectorRoute, true);
      assert.equal(detect.analytics.summaryRoute, true);
      // The Agent Kit is tooling: the demo must not carry it.
      assert.equal(detect.agentKit, null);

      assert.equal(result.doctor.summary.error, 0, JSON.stringify(result.doctor.checks));
      assert.ok(result.search.results?.length > 0 || result.search.length > 0);
      // Secrets never leave the project: nothing in the answers looks like an env value.
      assert.doesNotMatch(stdout, /AUTH_SECRET=|CLOUDFLARE_ANALYTICS_TOKEN=/);
    } finally {
      rmSync(file, { force: true });
    }
  }
);
