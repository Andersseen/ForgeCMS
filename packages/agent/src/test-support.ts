import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Builds a throwaway project directory from `{ 'relative/path': contents }`. Test helper, not part of the API. */
export function makeProject(files: Record<string, string | object>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const SECRET = 'sk_live_SUPER_SECRET_VALUE_123456';

/** A realistic Angular/Analog + Cloudflare + admin + localization + analytics project, with secrets lying around. */
export function clientProject(
  overrides: Record<string, string | object> = {}
): Record<string, string | object> {
  return {
    'package.json': {
      name: 'client-site',
      dependencies: {
        '@angular/core': '21.2.10',
        '@analogjs/platform': '2.5.2',
        '@forge-cms/core': '1.0.0-rc.0',
        '@forge-cms/runtime': '1.0.0-rc.0',
        '@forge-cms/cloudflare': '1.0.0-rc.0',
        '@forge-cms/angular': '1.0.0-rc.0',
        '@forge-cms/admin': '1.0.0-rc.0',
        '@angular/cdk': '21.2.10',
        rxjs: '7.8.2',
        '@voltui/components': '1.1.0',
        'lumen-icons': '0.2.0'
      },
      devDependencies: { vite: '7.1.4', '@forge-cms/agent': '1.0.0-rc.0' }
    },
    'vite.config.ts':
      "import { angularLinker } from '@forge-cms/admin/vite';\nexport default { plugins: [angularLinker()] };\n",
    'wrangler.toml': [
      'name = "client"',
      '[vars]',
      'FORGE_SSR_ORIGIN = "https://client.example"',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      '[[r2_buckets]]',
      'binding = "BUCKET"',
      '[[analytics_engine_datasets]]',
      'binding = "ANALYTICS"',
      'dataset = "client"'
    ].join('\n'),
    '.env': `AUTH_SECRET=${SECRET}\nCLOUDFLARE_API_TOKEN=${SECRET}\n`,
    '.dev.vars': `AUTH_SECRET=${SECRET}\n`,
    'src/app/app.config.ts':
      "import { provideRouter, withComponentInputBinding } from '@angular/router';\nimport { provideForgeAnalytics, provideForgeCms } from '@forge-cms/angular';\nexport const appConfig = { providers: [provideRouter([], withComponentInputBinding()), provideForgeCms({}), provideForgeAnalytics({ enabled: true })] };\n",
    'src/app/app.routes.ts':
      "export const routes = [{ path: 'studio', loadChildren: () => import('./admin.routes') }];\n",
    'src/app/admin.routes.ts':
      "import { forgeAdminAuthRoutes, forgeAdminAnalyticsRoutes } from '@forge-cms/admin';\nconst MOUNT = '/studio';\nexport const ADMIN_ROUTES = [...forgeAdminAuthRoutes({ basePath: MOUNT }), ...forgeAdminAnalyticsRoutes()];\n",
    'src/server/collections.ts':
      "import { defineCollection, defineField } from '@forge-cms/core';\nexport const services = defineCollection({ slug: 'services', locales: ['es', 'en'], fields: { title: defineField.text({ localized: true }) } });\n",
    'src/server/routes/api/analytics/collect.post.ts': 'export default () => null;\n',
    'src/server/routes/api/analytics/summary.get.ts': 'export default () => null;\n',
    ...overrides
  };
}
