// Packed production SSR consumers — the roadmap 0.9 release gate (specs 078, 080, 081), extended by spec 084
// (roadmap 0.10 / P03) into the two complete durable deployment profiles.
//
// Forge is installed only from `pnpm pack` tarballs into external Analog apps, with strict peers and no
// automatic peer installation, then **built for production and served by the built server** (never a Vite
// dev server or a static preview):
//
//   technical  (`ssr-consumer/technical.mjs`, S01 + S02): Node `node-server`, in-memory database — concurrent
//              anonymous / A / B renders, linked bundles, transfer-state security, hydration request counts,
//              failure recovery, and no libSQL packaging workaround. Needs no external service:
//              `pnpm release:ssr`.
//   journey    (`ssr-consumer/journey.mjs`, S03 + P03): the tiny-project app (existing reusable admin) walked
//              bootstrap → draft → publish → SSR → hydrate → edit → fresh SSR → draft, then a durable-file
//              journey (multipart upload → access-checked serving → restart → delete), on
//              - Node `node-server` + an on-disk libSQL database + the real S3 adapter against Garage, and
//              - Cloudflare Pages output under local workerd (`wrangler pages dev`) + local D1 + local R2.
//              The Cloudflare evidence is local workerd/D1/R2, not a remote deployment. The Node half needs the
//              Garage service, so this stage runs through `pnpm test:s3 profiles` (which supplies
//              FORGE_S3_TEST_*) and fails — never skips — without it.
//
// Usage: node scripts/verify-ssr-consumer.mjs [technical] [journey]   (default: technical)
// FORGE_CMS_KEEP_SSR_TMP=1 keeps the temporary apps for inspection.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyJourneyConsumer } from './ssr-consumer/journey.mjs';
import { keep, pack } from './ssr-consumer/shared.mjs';
import { verifyTechnicalConsumer } from './ssr-consumer/technical.mjs';

const stages = process.argv.slice(2);
const selected = (name) => (stages.length === 0 ? name === 'technical' : stages.includes(name));

/** The Garage bucket + credentials `pnpm test:s3 profiles` provides; the journey cannot run without them. */
function s3FromEnvironment() {
  const required = (name) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not set. Run the journey through \`pnpm test:s3 profiles\`.`);
    }
    return value;
  };
  return {
    bucket: required('FORGE_S3_TEST_PROFILE_BUCKET'),
    region: required('FORGE_S3_TEST_REGION'),
    endpoint: required('FORGE_S3_TEST_ENDPOINT'),
    accessKeyId: required('FORGE_S3_TEST_ACCESS_KEY_ID'),
    secretAccessKey: required('FORGE_S3_TEST_SECRET_ACCESS_KEY')
  };
}

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-ssr-'));
try {
  const tarballs = pack(join(workDir, 'packs'));
  if (selected('technical')) await verifyTechnicalConsumer({ workDir, tarballs });
  if (selected('journey')) {
    await verifyJourneyConsumer({ workDir, tarballs, s3: s3FromEnvironment() });
  }
  console.log('\nPacked production SSR gate passed.');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
