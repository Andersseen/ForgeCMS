import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';
import { listDocs, readDocText, searchDocs } from './docs.js';
import { packageVersion } from './package-info.js';
import { fetchRuntimeMetadata } from './runtime-metadata.js';
import { supportFacts } from './support.js';

export interface ForgeMcpOptions {
  /** The project directory to inspect. Fixed at start-up; no tool accepts a path. */
  projectRoot: string;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

function json(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const message = error instanceof Error ? error.message : 'unexpected error';
  return { content: [{ type: 'text', text: message.slice(0, 500) }], isError: true };
}

/**
 * EXPERIMENTAL. The Forge MCP server: read-only, local, version-matched context for coding agents.
 *
 * It exposes no tool that writes, executes, deploys, reads an arbitrary path or reveals environment variables.
 * The only filesystem access is the bounded `ProjectReader` on the project root chosen at start-up.
 */
export function createForgeMcpServer(options: ForgeMcpOptions): McpServer {
  const version = packageVersion();
  const server = new McpServer({ name: 'forge-cms', version });

  server.registerTool(
    'forge_project_detect',
    {
      title: 'Detect the ForgeCMS setup of this project',
      description:
        'Read-only structured summary of how this project uses ForgeCMS (packages, framework, deployment profile, admin mount, localization, analytics). Never returns file contents or secrets.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    () => {
      try {
        return json(detectProject(options.projectRoot));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'forge_project_doctor',
    {
      title: 'Check the ForgeCMS integration of this project',
      description:
        'Small set of static, Forge-specific checks (pass | warning | error | unknown). Evidence, not proof; does not replace the compiler, linter or tests.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    () => {
      try {
        return json(doctorProject(options.projectRoot));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'forge_docs_search',
    {
      title: 'Search the ForgeCMS documentation for this exact version',
      description: `Searches the documentation and skills bundled with @forge-cms/agent ${version}. Offline and version-matched.`,
      inputSchema: {
        query: z.string().min(1).max(300).describe('What to look up, e.g. "localized title es en"'),
        limit: z.number().int().min(1).max(10).optional()
      },
      annotations: READ_ONLY
    },
    ({ query, limit }) => json({ version, results: searchDocs(query, limit ?? 5) })
  );

  server.registerTool(
    'forge_support',
    {
      title: 'ForgeCMS compatibility and support facts',
      description:
        'Supported and tested Node, Angular, Vite, Analog, deployment profiles and experimental status for this release.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    () => json(supportFacts(version))
  );

  server.registerTool(
    'forge_runtime_metadata',
    {
      title: 'Read the public metadata of a running ForgeCMS application',
      description:
        'Anonymous GET of the sanitized /api/v1/collections metadata of a running application (http or https origin). No cookies, no tokens, no redirects.',
      inputSchema: { origin: z.string().min(1).max(300).describe('e.g. http://localhost:4200') },
      annotations: { ...READ_ONLY, openWorldHint: true }
    },
    async ({ origin }) => {
      try {
        return json(await fetchRuntimeMetadata(origin));
      } catch (error) {
        return failure(error);
      }
    }
  );

  const textResource = (
    uri: string,
    text: string
  ): { contents: { uri: string; mimeType: string; text: string }[] } => ({
    contents: [{ uri, mimeType: 'text/markdown', text: text.slice(0, 200_000) }]
  });

  for (const entry of listDocs()) {
    const uri = entry.id.startsWith('skills/') ? `forge://${entry.id}` : `forge://${entry.id}`;
    server.registerResource(entry.id, uri, { title: entry.title, mimeType: 'text/markdown' }, () =>
      textResource(uri, readDocText(entry.id) ?? '')
    );
  }
  server.registerResource(
    'support',
    'forge://support',
    { title: 'Support facts', mimeType: 'application/json' },
    () => ({
      contents: [
        {
          uri: 'forge://support',
          mimeType: 'application/json',
          text: JSON.stringify(supportFacts(version), null, 2)
        }
      ]
    })
  );
  server.registerResource(
    'project',
    'forge://project',
    { title: 'Detected project setup', mimeType: 'application/json' },
    () => ({
      contents: [
        {
          uri: 'forge://project',
          mimeType: 'application/json',
          text: JSON.stringify(detectProject(options.projectRoot), null, 2)
        }
      ]
    })
  );

  return server;
}
