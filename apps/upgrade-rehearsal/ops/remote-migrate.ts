/**
 * Operator tool (spec 075): run the reviewed-migration workflow of spec 072 against a public app's
 * **remote** D1 database through Wrangler's remote bindings. Maintainer-only; never run in CI.
 *
 *   pnpm exec tsx apps/upgrade-rehearsal/ops/remote-migrate.ts <www|demo>            # read-only: plan + pending migrations
 *   pnpm exec tsx apps/upgrade-rehearsal/ops/remote-migrate.ts <www|demo> --apply    # after a verified backup
 *
 * Follow docs/DEPLOYMENT-HEALTH.md: back up first (`wrangler d1 export --remote`), read the plan,
 * review the app's `src/server/api/migrations.ts`, then apply. Destructive migrations are refused.
 * The runtime is built with the app's own collections and a throwaway signing secret: this script
 * never issues or verifies a session, so the production `AUTH_SECRET` is not needed and never read.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import type { CollectionDefinition, GlobalDefinition } from '@forge-cms/core';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { formatSchemaPlan, isMigrationError, type MigrationDefinition } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

interface Target {
  wranglerToml: string;
  load: () => Promise<{
    collections: readonly CollectionDefinition[];
    globals?: readonly GlobalDefinition[];
    migrations: MigrationDefinition[];
  }>;
}

const TARGETS: Record<string, Target> = {
  www: {
    wranglerToml: '../../wrangler.toml',
    load: async () => {
      const app = await import('../../www/src/server/api/runtime');
      const { migrations } = await import('../../www/src/server/api/migrations');
      return { collections: app.collections, globals: app.globals, migrations };
    }
  },
  demo: {
    wranglerToml: '../demo-aesthetics/wrangler.toml',
    load: async () => {
      const { collections } = await import('../../demo-aesthetics/src/server/api/collections');
      const { migrations } = await import('../../demo-aesthetics/src/server/api/migrations');
      return { collections, migrations };
    }
  }
};

/** The D1 `database_name`/`database_id` of the app's `DB` binding, from its wrangler.toml. */
function d1Binding(tomlPath: string): { database_name: string; database_id: string } {
  const toml = readFileSync(tomlPath, 'utf8');
  const block = /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/.exec(toml)?.[1] ?? '';
  const read = (key: string) => new RegExp(`${key}\\s*=\\s*"([^"]+)"`).exec(block)?.[1];
  const database_name = read('database_name');
  const database_id = read('database_id');
  if (!database_name || !database_id || read('binding') !== 'DB') {
    throw new Error(`${tomlPath}: no [[d1_databases]] binding named DB`);
  }
  return { database_name, database_id };
}

async function main(): Promise<void> {
  const [key, flag] = process.argv.slice(2);
  const target = key === undefined ? undefined : TARGETS[key];
  if (target === undefined || (flag !== undefined && flag !== '--apply')) {
    console.error('Usage: tsx apps/upgrade-rehearsal/ops/remote-migrate.ts <www|demo> [--apply]');
    process.exit(2);
  }

  const local = process.env['FORGE_MIGRATE_LOCAL'];
  const dir = mkdtempSync(join(tmpdir(), 'forge-remote-migrate-'));
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      name: `forge-remote-migrate-${key}`,
      compatibility_date: '2026-05-15',
      d1_databases: [
        { binding: 'DB', ...d1Binding(target.wranglerToml), remote: local === undefined }
      ]
    })
  );

  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    persist: local === undefined ? false : { path: local }
  });
  try {
    const { collections, globals, migrations } = await target.load();
    const env = { DB: proxy.env.DB, AUTH_SECRET: randomBytes(48).toString('base64') };
    const database = new D1DatabaseAdapter();
    const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });
    const runtime = new ForgeCmsRuntime({
      collections: [...collections],
      ...(globals !== undefined && { globals: [...globals] }),
      adapters: { database, auth, storage: new InMemoryStorageAdapter() },
      env
    });
    runtime.init();

    const where = local === undefined ? 'remote' : `local rehearsal (${local})`;
    console.log(`# ${key}: ${where} D1 ${d1Binding(target.wranglerToml).database_name}\n`);
    console.log(formatSchemaPlan(await runtime.planSchema()));
    console.table(await runtime.planMigrations(migrations));

    if (flag !== '--apply') {
      console.log('\nRead-only run. Back up, review the plan and migrations, then pass --apply.');
      return;
    }
    try {
      const report = await runtime.runMigrations(migrations, { allowDestructive: false });
      console.table(report.results);
      console.log(formatSchemaPlan(report.after));
    } catch (error) {
      if (isMigrationError(error)) {
        console.error(error.code, error.migrationId, error.status, error.message);
      }
      throw error;
    }
  } finally {
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
