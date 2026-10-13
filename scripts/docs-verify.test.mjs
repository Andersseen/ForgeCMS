// The documentation checks must fail on the defect they exist to catch (spec 091). `pnpm test:scripts`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  anchorsOf,
  checkLinks,
  checkReference,
  checkSnippets,
  checkStalePhrases,
  headingSlug
} from './docs/lib.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'forge-docs-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test('heading slugs follow the GitHub rule', () => {
  assert.equal(headingSlug('`@forge-cms/core`'), 'forge-cmscore');
  assert.equal(headingSlug('Dates & times (v2)'), 'dates--times-v2');
  assert.deepEqual([...anchorsOf('# A\n## A\n```\n# no\n```\n<a id="x"></a>')].sort(), [
    'a',
    'a-1',
    'x'
  ]);
});

test('a broken relative link, a missing anchor and a missing website page are reported', () => {
  const root = tree({
    'README.md':
      '[ok](docs/a.md#real) [gone](docs/missing.md) [bad](docs/a.md#nope) [site](/docs/nope) [site-ok](/docs/page#top)',
    'docs/a.md': '# Real\n',
    'apps/www/src/content/docs/page.md': '---\ntitle: P\n---\n# Top\n'
  });
  const { failures } = checkLinks({ root, files: [join(root, 'README.md')] });
  assert.equal(failures.length, 3);
  assert.match(failures.join('\n'), /missing\.md/);
  assert.match(failures.join('\n'), /#nope/);
  assert.match(failures.join('\n'), /\/docs\/nope/);
});

test('a repository link to a deleted path fails and external links are only reported', () => {
  const root = tree({
    'README.md':
      '[x](https://github.com/Andersseen/ForgeCMS/blob/main/gone.ts) [e](https://example.com/a)\n```\n[skip](nowhere.md)\n```'
  });
  const result = checkLinks({ root, files: [join(root, 'README.md')] });
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.external, ['https://example.com/a']);
});

test('a drifted snippet is reported and an identical one passes', () => {
  const root = tree({
    'docs/examples/a.ts': 'export const a = 1;\n',
    'ok.md': '<!-- snippet: docs/examples/a.ts -->\n```ts\nexport const a = 1;\n```\n',
    'drift.md': '<!-- snippet: docs/examples/a.ts -->\n```ts\nexport const a = 2;\n```\n',
    'orphan.md': '<!-- snippet: docs/examples/a.ts -->\nno fence here\n'
  });
  assert.equal(checkSnippets({ root, files: [join(root, 'ok.md')] }).failures.length, 0);
  assert.match(checkSnippets({ root, files: [join(root, 'drift.md')] }).failures[0], /drifted/);
  assert.match(
    checkSnippets({ root, files: [join(root, 'orphan.md')] }).failures[0],
    /not followed/
  );
});

test('the reference must cover every entry point and not misattribute an export', () => {
  const baselines = {
    '@forge-cms/core': ['defineCollection'],
    '@forge-cms/runtime': ['handleList']
  };
  const good =
    '## `@forge-cms/core`\nUse `defineCollection`.\n## `@forge-cms/runtime`\nUse `handleList`.\n';
  assert.equal(checkReference({ markdown: good, baselines }).failures.length, 0);
  const missing = '## `@forge-cms/core`\nUse `defineCollection`.\n';
  assert.match(
    checkReference({ markdown: missing, baselines }).failures[0],
    /no section for @forge-cms\/runtime/
  );
  const wrong = '## `@forge-cms/core`\nUse `handleList`.\n## `@forge-cms/runtime`\n`handleList`\n';
  assert.match(checkReference({ markdown: wrong, baselines }).failures[0], /handleList/);
});

test('stale claims are caught', () => {
  const root = tree({ 'a.md': 'Early design phase\nfine line\nNothing published yet.' });
  assert.equal(checkStalePhrases({ root, files: [join(root, 'a.md')] }).failures.length, 2);
});
