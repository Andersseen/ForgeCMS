// Packed production SSR consumers — the roadmap 0.9 release gate (specs 078, 080, 081).
// `pnpm release:ssr` after `pnpm build`.
//
// Forge is installed only from `pnpm pack` tarballs into external Analog apps, with strict peers and no
// automatic peer installation, then **built for production and served by the built server** (never a Vite
// dev server or a static preview):
//
//   1. technical consumer (`ssr-consumer/technical.mjs`, S01 + S02): Node `node-server`, in-memory database —
//      concurrent anonymous / A / B renders, linked bundles, transfer-state security, hydration request counts,
//      failure recovery, and no libSQL packaging workaround;
//   2. production journey (`ssr-consumer/journey.mjs`, S03): the tiny-project app (existing reusable admin)
//      walked bootstrap → draft → publish → SSR → hydrate → edit → fresh SSR → draft, on
//      - Node `node-server` + an on-disk libSQL database (including a server restart), and
//      - Cloudflare Pages output under local workerd (`wrangler pages dev`) + a local D1 binding.
//      The Cloudflare evidence is local workerd/D1, not a remote deployment.
//
// Usage: node scripts/verify-ssr-consumer.mjs [technical] [journey]
// FORGE_CMS_KEEP_SSR_TMP=1 keeps the temporary apps for inspection.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyJourneyConsumer } from './ssr-consumer/journey.mjs';
import { keep, pack } from './ssr-consumer/shared.mjs';
import { verifyTechnicalConsumer } from './ssr-consumer/technical.mjs';

const stages = process.argv.slice(2);
const selected = (name) => stages.length === 0 || stages.includes(name);

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-ssr-'));
try {
  const tarballs = pack(join(workDir, 'packs'));
  if (selected('technical')) await verifyTechnicalConsumer({ workDir, tarballs });
  if (selected('journey')) await verifyJourneyConsumer({ workDir, tarballs });
  console.log('\nPacked production SSR gate passed.');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
