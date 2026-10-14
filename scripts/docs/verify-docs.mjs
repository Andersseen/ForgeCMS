// Documentation verification — roadmap 0.12 / R04, spec 091. `pnpm docs:verify`.
//
// Fast, deterministic, offline. It does NOT rerun the Forge CI matrix (coverage, performance and
// `release:certify` stay their own gates); it answers one question: can a reader trust what the docs say?
//
//   links       every relative / website / repository link in the current-facing documents resolves, including
//               `#anchor`s into Markdown. External URLs are listed, never fatal (no network in the gate).
//   snippets    every `<!-- snippet: path -->` block equals the example file the verifiers actually build.
//   reference   docs/REFERENCE.md covers all 15 public entry points and attributes no export to the wrong package.
//   agent kit   MCP tools/resources and skills are documented and real; package count; experimental labels (spec 093).
//   stale       phrases that were true once ("nothing published yet", "Early design phase", …) stay out.
//
// The executable half — the two quickstarts installed from packed tarballs — is `pnpm docs:verify:consumers`.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkAgentKitDocs,
  checkLinks,
  checkReference,
  checkSnippets,
  checkStalePhrases,
  markdownFiles
} from './lib.mjs';

const root = process.cwd();
const at = (...parts) => join(root, ...parts);
const exists = (path) => existsSync(at(path));

const topLevelDocs = readdirSync(at('docs'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => at('docs', name));
const packageReadmes = readdirSync(at('packages'))
  .map((name) => at('packages', name, 'README.md'))
  .filter(existsSync);
const websiteDocs = markdownFiles(at('apps/www/src/content/docs'));
const rootDocs = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CLAUDE.md', 'AGENTS.md']
  .filter(exists)
  .map((name) => at(name));
const roadmapDocs = markdownFiles(at('docs/roadmap'));
const recentSpecs = readdirSync(at('docs/specs'))
  .filter((name) => /^(08[8-9]|09\d)-.*\.md$/.test(name))
  .map((name) => at('docs/specs', name));

/** Documents a newcomer reads. STATE.md and DEMO-FINDINGS.md are chronological records, so they are link-checked only. */
const HISTORICAL = new Set(['STATE.md', 'DEMO-FINDINGS.md', 'ROADMAP-LEGACY.md']);
const currentFacing = [
  ...rootDocs,
  ...topLevelDocs.filter((file) => !HISTORICAL.has(file.split('/').at(-1))),
  ...packageReadmes,
  ...websiteDocs
];
const linkChecked = [
  ...new Set([...currentFacing, ...topLevelDocs, ...roadmapDocs, ...recentSpecs])
];

const failures = [];
const report = (title, list) => {
  console.log(`${list.length === 0 ? '✓' : '✗'} ${title}`);
  for (const failure of list) console.log(`    ${failure}`);
  failures.push(...list);
};

const links = checkLinks({ root, files: linkChecked });
report(`links: ${linkChecked.length} documents`, links.failures);

const snippets = checkSnippets({ root, files: [...currentFacing, ...topLevelDocs] });
report(
  `snippets: ${snippets.count} embedded example blocks match docs/examples`,
  snippets.failures
);

const baselineDir = at('api-baseline');
const baselines = {};
for (const file of readdirSync(baselineDir).filter((name) => name.endsWith('.json'))) {
  // `_forge-cms_angular_server.json` -> `@forge-cms/angular/server`
  const specifier = `@forge-cms/${file.slice('_forge-cms_'.length, -'.json'.length).replaceAll('_', '/')}`;
  baselines[specifier] = JSON.parse(readFileSync(join(baselineDir, file), 'utf8'));
}
const referencePath = at('docs/REFERENCE.md');
if (existsSync(referencePath)) {
  const reference = checkReference({ markdown: readFileSync(referencePath, 'utf8'), baselines });
  report(
    `reference: ${reference.sections.length} sections cover ${Object.keys(baselines).length} public entry points`,
    reference.failures
  );
} else {
  report('reference', ['docs/REFERENCE.md does not exist']);
}

const agentKit = checkAgentKitDocs({ root });
report(
  `agent kit: ${agentKit.tools.length} MCP tools, ${agentKit.skills.length} skills, experimental labels, package count`,
  agentKit.failures
);

report('stale claims', checkStalePhrases({ root, files: currentFacing }).failures);

console.log(`\nExternal links (report-only, not checked here): ${links.external.length}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} documentation problem(s).`);
  process.exit(1);
}
console.log('\nDocumentation checks passed.');
