#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { createForgeMcpServer } from './server.js';

// EXPERIMENTAL local MCP server (stdio). Usage: `pnpm exec forge-cms-mcp [--root <project dir>]`.
// It collects no telemetry and makes no network request on its own.
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(
  rootIndex !== -1 && args[rootIndex + 1] ? (args[rootIndex + 1] as string) : process.cwd()
);

const server = createForgeMcpServer({ projectRoot: root });
await server.connect(new StdioServerTransport());
