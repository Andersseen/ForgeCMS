// Spec 093: the experimental Agent Kit is development tooling. Nothing else may depend on it, and it may not
// depend on the CMS. Static, repository-wide, so a regression fails `pnpm test` immediately.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const deps = (pkg) => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies
});

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|mjs|js)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.includes('node_modules') && !file.includes('/dist/'));
}

test('no other workspace package or app depends on @forge-cms/agent or the MCP SDK', () => {
  for (const parent of ['packages', 'apps']) {
    for (const name of readdirSync(parent)) {
      if (parent === 'packages' && name === 'agent') continue;
      let pkg;
      try {
        pkg = manifest(join(parent, name));
      } catch {
        continue;
      }
      const all = deps(pkg);
      assert.ok(!('@forge-cms/agent' in all), `${parent}/${name} depends on @forge-cms/agent`);
      assert.ok(
        !Object.keys(all).some((d) => d.startsWith('@modelcontextprotocol/')),
        `${parent}/${name} depends on the MCP SDK`
      );
    }
  }
});

test('no stable package source imports the agent kit or the MCP SDK', () => {
  for (const name of readdirSync('packages')) {
    if (name === 'agent') continue;
    for (const file of sourceFiles(join('packages', name, 'src'))) {
      const text = readFileSync(file, 'utf8');
      assert.ok(
        !/@forge-cms\/agent|@modelcontextprotocol/.test(text),
        `${file} references the agent kit`
      );
    }
  }
});

test('the agent kit has no runtime dependency on any other Forge package', () => {
  const pkg = manifest('packages/agent');
  assert.deepEqual(
    Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((d) =>
      d.startsWith('@forge-cms/')
    ),
    []
  );
  for (const file of sourceFiles('packages/agent/src').filter(
    (f) => !f.endsWith('.test.ts') && !f.endsWith('test-support.ts')
  )) {
    assert.ok(
      !/^(?:import|export)[^;]*?from\s+['"]@forge-cms\//m.test(readFileSync(file, 'utf8')),
      `${file} imports a Forge package`
    );
  }
});

test('the agent kit is a dev-time Node >= 22 ESM package that declares its bin', () => {
  const pkg = manifest('packages/agent');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.bin['forge-cms-mcp'], './dist/bin.js');
  assert.equal(pkg.bin['forge-cms-agent'], './dist/init-bin.js');
  assert.ok(pkg.files.includes('skills') && pkg.files.includes('docs'));
  assert.match(pkg.description, /EXPERIMENTAL/);
});
