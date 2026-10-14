import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createForgeMcpServer } from './server.js';
import { packageVersion } from './package-info.js';
import { SECRET, clientProject, makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function connect(files: Record<string, string | object>): Promise<Client> {
  const made = makeProject(files);
  cleanups.push(made.cleanup);
  const server = createForgeMcpServer({ projectRoot: made.root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(() => void client.close());
  return client;
}

const text = (result: unknown): string =>
  ((result as { content: { text: string }[] }).content[0] as { text: string }).text;

describe('MCP server', () => {
  it('handshakes and lists exactly the five read-only tools', async () => {
    const client = await connect(clientProject());
    expect(client.getServerVersion()?.name).toBe('forge-cms');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'forge_docs_search',
      'forge_project_detect',
      'forge_project_doctor',
      'forge_runtime_metadata',
      'forge_support'
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(
        /"(path|file|filename|command|cmd|shell|script)"/i
      );
    }
  });

  it('exposes no write, execute or file-reading tool by name', async () => {
    const { tools } = await (await connect(clientProject())).listTools();
    for (const tool of tools) {
      expect(tool.name).not.toMatch(
        /(^|_)(read|file|write|exec|execute|run|shell|delete|deploy|migrate|create|update)(_|$)/i
      );
    }
  });

  it('forge_project_detect identifies the installed Forge, Angular and Analog versions', async () => {
    const client = await connect(clientProject());
    const detected = JSON.parse(
      text(await client.callTool({ name: 'forge_project_detect', arguments: {} }))
    );
    expect(detected.forgePackages['@forge-cms/core'].declared).toBe('1.0.0-rc.0');
    expect(detected.framework).toMatchObject({ angular: '21.2.10', analog: '2.5.2' });
    expect(detected.admin).toEqual({ detected: true, mount: '/studio' });
  });

  it('forge_support reports compatibility and experimental status for this exact version', async () => {
    const client = await connect(clientProject());
    const facts = JSON.parse(text(await client.callTool({ name: 'forge_support', arguments: {} })));
    expect(facts.forgeVersion).toBe(packageVersion());
    expect(facts.angularAdmin.supported).toMatch(/21/);
    expect(facts.analytics.status).toBe('experimental');
    expect(facts.agentKit.status).toBe('experimental');
  });

  it('forge_docs_search finds localization and Analytics guidance', async () => {
    const client = await connect(clientProject());
    const loc = JSON.parse(
      text(
        await client.callTool({
          name: 'forge_docs_search',
          arguments: { query: 'localized title in Spanish and English' }
        })
      )
    );
    expect(JSON.stringify(loc.results)).toMatch(/localized: true/);
    const analytics = JSON.parse(
      text(
        await client.callTool({
          name: 'forge_docs_search',
          arguments: { query: 'analytics dashboard setup' }
        })
      )
    );
    expect(analytics.results.length).toBeGreaterThan(0);
    expect(analytics.version).toBe(packageVersion());
  });

  it('forge_project_doctor warns on one deliberate misconfiguration', async () => {
    const client = await connect(clientProject({ 'vite.config.ts': 'export default {}' }));
    const report = JSON.parse(
      text(await client.callTool({ name: 'forge_project_doctor', arguments: {} }))
    );
    expect(report.checks.find((c: { id: string }) => c.id === 'vite-linker').status).toBe(
      'warning'
    );
  });

  it('lists docs, skills, support and project as resources and reads them', async () => {
    const client = await connect(clientProject());
    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'forge://docs/quickstart',
        'forge://docs/reference',
        'forge://docs/analytics',
        'forge://skills/forgecms-localization',
        'forge://support',
        'forge://project'
      ])
    );
    const read = await client.readResource({ uri: 'forge://skills/forgecms-localization' });
    expect(JSON.stringify(read)).toContain('localized: true');
  });
});

describe('MCP security boundary', () => {
  it('never returns .env / .dev.vars / wrangler secrets from any tool or resource', async () => {
    const client = await connect(
      clientProject({
        'wrangler.toml': `[vars]\nAUTH_SECRET = "${SECRET}"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`
      })
    );
    const outputs = [
      text(await client.callTool({ name: 'forge_project_detect', arguments: {} })),
      text(await client.callTool({ name: 'forge_project_doctor', arguments: {} })),
      text(await client.callTool({ name: 'forge_support', arguments: {} })),
      text(
        await client.callTool({
          name: 'forge_docs_search',
          arguments: { query: 'AUTH_SECRET cloudflare token' }
        })
      ),
      JSON.stringify(await client.readResource({ uri: 'forge://project' }))
    ];
    for (const output of outputs) {
      expect(output).not.toContain(SECRET);
      expect(output).not.toContain('sk_live');
      expect(output).not.toContain('00000000-0000-0000-0000-000000000000');
    }
  });

  it('ignores path-like arguments: ../../.env cannot turn a tool into a file reader', async () => {
    const client = await connect(clientProject());
    for (const name of ['forge_project_detect', 'forge_project_doctor', 'forge_support']) {
      const result = await client.callTool({
        name,
        arguments: { path: '../../.env', file: '/etc/passwd', root: '/' }
      });
      expect(text(result)).not.toContain('root:');
      expect(text(result)).not.toContain(SECRET);
    }
    const search = await client.callTool({
      name: 'forge_docs_search',
      arguments: { query: '../../.env /etc/passwd' }
    });
    expect(text(search)).not.toContain('root:x');
    await expect(client.readResource({ uri: 'forge://docs/../../.env' })).rejects.toThrow();
    await expect(client.readResource({ uri: 'file:///etc/passwd' })).rejects.toThrow();
  });

  it('offers no way to call a missing/forbidden tool', async () => {
    const client = await connect(clientProject());
    for (const name of ['read_file', 'execute', 'forge_run_migration', 'forge_write']) {
      const outcome = await client.callTool({ name, arguments: {} }).then(
        (result) => result,
        (error: unknown) => ({ isError: true, error })
      );
      expect((outcome as { isError?: boolean }).isError).toBe(true);
    }
  });

  it('forge_runtime_metadata refuses non-http origins, credentials and unreachable hosts', async () => {
    const client = await connect(clientProject());
    for (const origin of [
      'file:///etc/passwd',
      'ftp://host',
      'javascript:alert(1)',
      'http://user:pass@localhost:1',
      'not a url'
    ]) {
      const result = await client.callTool({
        name: 'forge_runtime_metadata',
        arguments: { origin }
      });
      expect((result as { isError?: boolean }).isError, origin).toBe(true);
      expect(text(result)).not.toContain('pass');
    }
  });
});
