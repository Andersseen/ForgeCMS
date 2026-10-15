#!/usr/bin/env node
import { runCli } from './cli.js';

// EXPERIMENTAL: `pnpm exec forge-cms-agent init|check|sync`. Writes only inside the project directory.
process.exitCode = runCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line)
});
