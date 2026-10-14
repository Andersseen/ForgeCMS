import { afterEach, describe, expect, it } from 'vitest';
import { doctorProject } from './doctor.js';
import { clientProject, makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});
const check = (files: Record<string, string | object>, id: string) => {
  const made = makeProject(files);
  cleanups.push(made.cleanup);
  return doctorProject(made.root).checks.find((entry) => entry.id === id);
};
const pkg = (extra: Record<string, string>, base: Record<string, unknown> = {}) => ({
  ...(clientProject()['package.json'] as object),
  ...base,
  dependencies: {
    ...(clientProject()['package.json'] as { dependencies: object }).dependencies,
    ...extra
  }
});

describe('doctorProject', () => {
  it('passes a healthy client project', () => {
    const made = makeProject(clientProject());
    cleanups.push(made.cleanup);
    const report = doctorProject(made.root);
    expect(report.summary.error).toBe(0);
    expect(report.summary.warning).toBe(0);
    expect(report.checks.find((c) => c.id === 'family-versions')?.status).toBe('pass');
    expect(report.note).toMatch(/not proof|evidence/i);
  });

  it('is unknown (not a pass) when no Forge package or package.json exists', () => {
    expect(check({ 'package.json': { name: 'x' } }, 'forge-installed')?.status).toBe('unknown');
    expect(check({ 'README.md': 'x' }, 'package-json')?.status).toBe('unknown');
  });

  it('errors on a split fixed family', () => {
    const result = check(
      clientProject({ 'package.json': pkg({ '@forge-cms/db': '0.13.4' }) }),
      'family-versions'
    );
    expect(result?.status).toBe('error');
    expect(result?.evidence).toEqual(expect.arrayContaining(['0.13.4', '1.0.0-rc.0']));
  });

  it('errors on the admin with Angular 22', () => {
    const result = check(
      clientProject({ 'package.json': pkg({ '@angular/core': '^22.0.0' }) }),
      'admin-angular'
    );
    expect(result?.status).toBe('error');
  });

  it('warns about missing admin peers', () => {
    const base = pkg({}) as { dependencies: Record<string, string> };
    delete base.dependencies['@angular/cdk'];
    const result = check(clientProject({ 'package.json': base }), 'admin-peers');
    expect(result).toMatchObject({ status: 'warning', evidence: ['@angular/cdk'] });
  });

  it('warns when the official Vite linker is missing', () => {
    expect(
      check(clientProject({ 'vite.config.ts': 'export default {}' }), 'vite-linker')?.status
    ).toBe('warning');
  });

  it('warns when withComponentInputBinding() is missing', () => {
    const result = check(
      clientProject({
        'src/app/app.config.ts':
          "import { provideRouter } from '@angular/router';\nexport const c = provideRouter([]);\n"
      }),
      'component-input-binding'
    );
    expect(result?.status).toBe('warning');
  });

  it('errors when browser code imports a server-only package, and on deep imports', () => {
    const files = clientProject({
      'src/app/bad.component.ts':
        "import { ForgeCmsRuntime } from '@forge-cms/runtime';\nimport x from '@forge-cms/core/dist/index.js';\n",
      'src/app/admin.routes.ts':
        "import { forgeAdminAuthRoutes } from '@forge-cms/admin';\nimport y from '@forge-cms/core/src/index';\nforgeAdminAuthRoutes({ basePath: '/studio' });\n"
    });
    expect(check(files, 'browser-server-imports')?.status).toBe('error');
    expect(check(files, 'deep-imports')?.status).toBe('error');
  });

  it('warns for DB without BUCKET and for BUCKET without DB', () => {
    const toml = (body: string) => ({ 'wrangler.toml': body });
    expect(
      check(clientProject(toml('[[d1_databases]]\nbinding = "DB"')), 'cloudflare-bindings')?.status
    ).toBe('warning');
    expect(
      check(clientProject(toml('[[r2_buckets]]\nbinding = "BUCKET"')), 'cloudflare-bindings')
        ?.status
    ).toBe('warning');
  });

  it('errors when a secret is declared in wrangler [vars] and reports the name only', () => {
    const result = check(
      clientProject({
        'wrangler.toml': '[vars]\nAUTH_SECRET = "hunter2-hunter2-hunter2-hunter2"\n'
      }),
      'secret-in-vars'
    );
    expect(result?.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('warns when the tracker is enabled but the ANALYTICS binding is missing', () => {
    const files = clientProject({
      'wrangler.toml': '[[d1_databases]]\nbinding = "DB"\n[[r2_buckets]]\nbinding = "BUCKET"\n'
    });
    expect(check(files, 'analytics-binding')?.status).toBe('warning');
  });

  it('warns when the Analytics dashboard route has no summary route', () => {
    const files = clientProject();
    delete files['src/server/routes/api/analytics/summary.get.ts'];
    expect(check(files, 'analytics-summary-route')?.status).toBe('warning');
  });

  it('warns when the agent kit is a production dependency', () => {
    const base = pkg({ '@forge-cms/agent': '1.0.0-rc.0' }) as unknown as {
      devDependencies: Record<string, string>;
    };
    delete base.devDependencies['@forge-cms/agent'];
    expect(check(clientProject({ 'package.json': base }), 'agent-dev-only')?.status).toBe(
      'warning'
    );
  });

  it('warns on a runtime that only has in-memory adapters', () => {
    const files = {
      'package.json': { dependencies: { '@forge-cms/runtime': '1.0.0', '@forge-cms/db': '1.0.0' } },
      'src/server/runtime.ts': 'new InMemoryDatabaseAdapter();'
    };
    expect(check(files, 'in-memory-production')?.status).toBe('warning');
  });
});
