#!/usr/bin/env node
// Builds the version-matched documentation corpus that ships inside `@forge-cms/agent` (spec 093).
// Run from `packages/agent` (prebuild/pretest) or the repo root. It copies a CURATED list of consumer
// documents into `packages/agent/docs/` and writes `index.json`. Historical implementation specs are never
// part of the corpus: they are not consumer guidance.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'packages', 'agent', 'docs');

/** [id, source path relative to the repo root]. The id is what `forge_docs_search` returns. */
export const AGENT_DOCS = [
  ['server-quickstart', 'apps/www/src/content/docs/server-quickstart.md'],
  ['angular-quickstart', 'apps/www/src/content/docs/angular-quickstart.md'],
  ['quickstart', 'apps/www/src/content/docs/quickstart.md'],
  ['reference', 'docs/REFERENCE.md'],
  ['matrices', 'docs/MATRICES.md'],
  ['support', 'docs/SUPPORT.md'],
  ['limitations', 'docs/LIMITATIONS.md'],
  ['migrating-to-1.0', 'docs/MIGRATING-TO-1.0.md'],
  ['collections', 'apps/www/src/content/docs/collections.md'],
  ['fields', 'apps/www/src/content/docs/fields.md'],
  ['hooks', 'apps/www/src/content/docs/hooks.md'],
  ['access-control', 'apps/www/src/content/docs/access-control.md'],
  ['browser-auth', 'apps/www/src/content/docs/browser-auth.md'],
  ['machine-auth', 'apps/www/src/content/docs/machine-auth.md'],
  ['uploads', 'apps/www/src/content/docs/uploads.md'],
  ['admin-ui', 'apps/www/src/content/docs/admin-ui.md'],
  ['angular-client', 'apps/www/src/content/docs/angular-client.md'],
  ['ssr', 'apps/www/src/content/docs/ssr.md'],
  ['adapters', 'apps/www/src/content/docs/adapters.md'],
  ['deployment', 'apps/www/src/content/docs/deployment.md'],
  ['schema-upgrades', 'docs/SCHEMA-UPGRADES.md'],
  ['backup-restore', 'docs/BACKUP-RESTORE.md'],
  ['deployment-health', 'docs/DEPLOYMENT-HEALTH.md'],
  ['analytics', 'apps/www/src/content/docs/analytics.md'],
  ['troubleshooting', 'apps/www/src/content/docs/troubleshooting.md']
];

function title(markdown, fallback) {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  const fromFront = front && /^title:\s*(.+)$/m.exec(front[1]);
  if (fromFront) return fromFront[1].trim().replace(/^['"]|['"]$/g, '');
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading ? heading[1].trim() : fallback;
}

const version = JSON.parse(
  readFileSync(join(root, 'packages', 'agent', 'package.json'), 'utf8')
).version;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const docs = [];
for (const [id, source] of AGENT_DOCS) {
  let text;
  try {
    text = readFileSync(join(root, source), 'utf8');
  } catch {
    throw new Error(`Agent docs corpus: missing source ${source} for "${id}"`);
  }
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  writeFileSync(join(out, `${id}.md`), body);
  docs.push({ id, title: title(text, id) });
}
writeFileSync(join(out, 'index.json'), `${JSON.stringify({ version, docs }, null, 2)}\n`);
console.log(`agent docs: ${docs.length} documents for ${version}`);
