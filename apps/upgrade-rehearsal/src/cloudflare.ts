import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Miniflare } from 'miniflare';
import {
  D1DatabaseAdapter,
  R2StorageAdapter,
  type D1Database,
  type R2Bucket
} from '@forge-cms/cloudflare';
import { createInstallation, type Installation } from './runtime.js';

const require = createRequire(import.meta.url);
const WRANGLER = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

/**
 * One isolated local Cloudflare environment: its own directory, `wrangler.jsonc` and `.wrangler/state`
 * (D1 + R2). SOURCE and RESTORED are two of these; they share nothing on disk. Everything is `--local`:
 * no account, no credentials, and the child processes never even see Cloudflare credentials.
 */
export class LocalCloudflareEnvironment {
  readonly databaseName = 'forge-rehearsal';
  readonly bucketName = 'forge-rehearsal-media';
  readonly configPath: string;

  constructor(
    readonly dir: string,
    /** Distinct per environment, so even a shared persistence root could not alias them. */
    readonly databaseId: string
  ) {
    mkdirSync(dir, { recursive: true });
    this.configPath = join(dir, 'wrangler.jsonc');
    writeFileSync(
      this.configPath,
      JSON.stringify(
        {
          name: `forge-rehearsal-${databaseId.slice(-4)}`,
          compatibility_date: '2026-09-01',
          d1_databases: [
            { binding: 'DB', database_name: this.databaseName, database_id: databaseId }
          ],
          r2_buckets: [{ binding: 'BUCKET', bucket_name: this.bucketName }]
        },
        null,
        2
      )
    );
  }

  private get statePath(): string {
    return join(this.dir, '.wrangler', 'state', 'v3');
  }

  /** Runs the repository's pinned Wrangler against this environment's local state only. */
  wrangler(args: string[]): string {
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (name.startsWith('CLOUDFLARE_') || name.startsWith('CF_')) delete env[name];
    }
    return execFileSync(process.execPath, [WRANGLER, ...args, '--config', this.configPath], {
      cwd: this.dir,
      env: {
        ...env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: join(this.dir, 'wrangler-logs'),
        NO_COLOR: '1'
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  /** `wrangler d1 execute <db> --local --file <sql>` — the documented import path, locally. */
  importSql(file: string): void {
    this.wrangler(['d1', 'execute', this.databaseName, '--local', '--file', file, '--yes']);
  }

  /** `wrangler d1 export <db> --local --output <file>` — the documented export path, locally. */
  exportSql(file: string): void {
    this.wrangler(['d1', 'export', this.databaseName, '--local', '--output', file]);
  }

  /** Real local D1 + R2 bindings (workerd, via Miniflare) over this environment's state. */
  async start(): Promise<{ db: D1Database; bucket: R2Bucket; dispose(): Promise<void> }> {
    const miniflare = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response(null, { status: 204 }); } }',
      d1Databases: { DB: this.databaseId },
      r2Buckets: { BUCKET: this.bucketName },
      d1Persist: join(this.statePath, 'd1'),
      r2Persist: join(this.statePath, 'r2')
    });
    const db = (await miniflare.getD1Database('DB')) as unknown as D1Database;
    const bucket = (await miniflare.getR2Bucket('BUCKET')) as unknown as R2Bucket;
    return { db, bucket, dispose: () => miniflare.dispose() };
  }
}

/** The current ForgeCMS over an environment's D1 + R2, exactly as a Worker would wire it. */
export async function openCloudflareInstallation(
  environment: LocalCloudflareEnvironment
): Promise<Installation & { dispose(): Promise<void> }> {
  const { db, bucket, dispose } = await environment.start();
  const installation = createInstallation({
    profile: 'd1-r2',
    database: new D1DatabaseAdapter(),
    storage: new R2StorageAdapter(),
    bindings: { DB: db, BUCKET: bucket },
    sql: async (query) => (await db.prepare(query).all<Record<string, unknown>>()).results ?? []
  });
  return { ...installation, dispose };
}
