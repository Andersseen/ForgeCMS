#!/usr/bin/env node
// Production browser bundle sizes (spec 089). Packs the workspace, installs two external Analog apps from
// the tarballs (the R01 packed consumers), builds them for production and records the size of the real
// browser output — never a dev bundle, never source bytes:
//
//   technical  the SSR consumer using only @forge-cms/angular           → the SDK's cost in a consumer
//   admin      the tiny-project app with the reusable @forge-cms/admin  → the admin's route chunk
//
// Needs no Docker, database or browser. Writes .quality/performance/bundle.json; budgets are judged by
// scripts/quality/performance.mjs. The server-marker / secret / unlinked-declaration scans of the R01
// builds run as part of the same builds and still fail immediately.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJourneyConsumer } from '../ssr-consumer/journey.mjs';
import { keep, pack } from '../ssr-consumer/shared.mjs';
import { buildTechnicalConsumer } from '../ssr-consumer/technical.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.env.FORGE_BUNDLE_REPORT = join(root, '.quality', 'performance', 'bundle.json');
rmSync(process.env.FORGE_BUNDLE_REPORT, { force: true });

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-bundle-'));
try {
  const tarballs = pack(join(workDir, 'packs'));
  buildTechnicalConsumer({ workDir, tarballs });
  buildJourneyConsumer({ workDir, tarballs });
  console.log(`\nBundle sizes written to ${process.env.FORGE_BUNDLE_REPORT}`);
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
