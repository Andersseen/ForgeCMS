// Helpers shared by the documentation verifiers (spec 091). Repository tooling only.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const repoRoot = process.cwd();
export const keep = process.env.FORGE_CMS_KEEP_SSR_TMP === '1';

export function run(command, args, cwd, env = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, CI: 'true', ...env }
    });
  } catch (err) {
    process.stdout.write(String(err.stdout ?? ''));
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

/** Copy `docs/examples/<name>` into `dir`, preserving the relative layout. */
export function copyExample(name, dir) {
  const from = join(repoRoot, 'docs', 'examples', name);
  for (const file of readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const source = join(file.parentPath, file.name);
    const target = join(dir, source.slice(from.length + 1));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
}
