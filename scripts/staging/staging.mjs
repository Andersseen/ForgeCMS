#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  StagingGuardError,
  assertDistinct,
  assertStagingName,
  buildCommands,
  buildManifest,
  compareObject,
  find,
  keysFromSnapshotSql,
  sha256,
  verifyOrigin
} from './staging-lib.mjs';

/**
 * R03 staging + recovery rehearsal driver (spec 090, docs/STAGING-REHEARSAL.md). Repository tooling only.
 *
 * READ-ONLY (safe to rerun, never touches Cloudflare unless `verify` is pointed at a served staging origin):
 *   manifest [--suffix s]                     print the isolated resources R03 may create
 *   plan <provision|secrets|deploy|export> [--suffix s] [--commit sha]   print the exact wrangler commands
 *   verify --origin https://… [--secret m]    health + exposure check of the staging origin
 *   keys --snapshot backup.sql                required R2 keys, derived from the D1 snapshot
 *   compare --expected a.json --actual b.json compare copied-object records (sha256/size/type/metadata)
 *
 * MUTATING (remote; refuse anything that is not a forge-cms-r03-* name, default to dry run):
 *   run <provision|secrets|deploy|export> --apply [--suffix s] [--commit sha] [--out file]
 *
 * Generated evidence (backups, cookies, secrets) belongs under .staging/ (gitignored). Secrets are generated
 * here, piped on stdin, and never printed.
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

export async function main() {
  const [command, step] = args;
  const manifest = buildManifest({ suffix: flag('suffix') ?? '' });
  const commit = flag('commit');
  const commands = buildCommands(manifest, { ...(commit && { commit }) });

  switch (command) {
    case 'manifest':
      console.log(JSON.stringify(manifest, null, 2));
      return 0;
    case 'plan':
    case 'run': {
      const apply = command === 'run' && has('apply');
      return runStep(step, manifest, commands, apply);
    }
    case 'verify': {
      const origin = flag('origin');
      if (!origin) throw new StagingGuardError('--origin is required');
      const secrets = args.flatMap((a, i) => (a === '--secret' ? [args[i + 1]] : []));
      const report = await verifyOrigin(origin, { secrets });
      for (const r of report.results) {
        console.log(
          `${r.ok ? 'ok  ' : 'FAIL'} ${r.status} ${r.path}${r.problems.length ? ` — ${r.problems.join('; ')}` : ''}`
        );
      }
      return report.ok ? 0 : 1;
    }
    case 'keys': {
      const file = flag('snapshot');
      if (!file) throw new StagingGuardError('--snapshot is required');
      const keys = await keysFromSnapshotSql(readFileSync(file, 'utf8'));
      console.log(
        JSON.stringify({ count: keys.length, keys, keyHashes: keys.map(sha256) }, null, 2)
      );
      return 0;
    }
    case 'compare': {
      const expected = JSON.parse(readFileSync(flag('expected'), 'utf8'));
      const actual = JSON.parse(readFileSync(flag('actual'), 'utf8'));
      let bad = 0;
      for (const [key, want] of Object.entries(expected)) {
        const problems = compareObject(want, actual[key]);
        if (problems.length) {
          bad += 1;
          console.log(`FAIL ${sha256(key).slice(0, 12)} ${problems.join(', ')}`);
        }
      }
      console.log(
        `${Object.keys(expected).length - bad}/${Object.keys(expected).length} objects match`
      );
      return bad === 0 ? 0 : 1;
    }
    default:
      console.error('usage: staging.mjs <manifest|plan|run|verify|keys|compare> …  (see header)');
      return 2;
  }
}

function runStep(step, manifest, commands, apply) {
  const out = flag('out') ?? '.staging/database.sql';
  const steps = {
    provision: commands.provision,
    secrets: commands.secrets,
    deploy: commands.deploy,
    export: commands.exportD1(out)
  };
  const argvList = steps[step];
  if (!argvList) throw new StagingGuardError(`unknown step "${step}"`);
  if (step === 'export') {
    assertDistinct(
      find(manifest, 'd1', 'staging database'),
      find(manifest, 'd1', 'restore database'),
      'd1'
    );
    mkdirSync(resolve(out, '..'), { recursive: true });
  }
  for (const argv of argvList) {
    console.log(`${apply ? 'RUN ' : 'PLAN'} pnpm exec ${argv.join(' ')}`);
    if (!apply) continue;
    // The only secret is AUTH_SECRET: freshly generated, staging-only, fed through stdin.
    const input = step === 'secrets' ? randomBytes(48).toString('base64url') : undefined;
    const result = spawnSync('pnpm', ['exec', ...argv], {
      stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      ...(input && { input }),
      env: process.env
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  if (!apply)
    console.log('(dry run — nothing executed; pass `run … --apply` after explicit authorization)');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        error instanceof StagingGuardError ? `REFUSED: ${error.message}` : error.message
      );
      process.exit(error instanceof StagingGuardError ? 3 : 1);
    }
  );
}
export { assertStagingName };
