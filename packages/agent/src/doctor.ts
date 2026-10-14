import type { ProjectScan } from './detect.js';
import { scanProject } from './detect.js';
import {
  FORGE_AGENT_PACKAGE,
  FORGE_RUNTIME_PACKAGES,
  SERVER_ONLY_PACKAGES
} from './forge-packages.js';

export type CheckStatus = 'pass' | 'warning' | 'error' | 'unknown';

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
  /** Names and paths only — never file contents or secret values. */
  evidence?: string[];
  docs?: string;
}

export interface DoctorReport {
  summary: Record<CheckStatus, number>;
  checks: DoctorCheck[];
  note: string;
}

const exact = (range: string): string => range.replace(/^[\^~><=\s]+/, '');
const major = (range: string): number | undefined => {
  const match = /(\d+)\./.exec(exact(range)) ?? /^(\d+)$/.exec(exact(range));
  return match?.[1] ? Number(match[1]) : undefined;
};

/** Small, high-confidence, Forge-specific checks. Static detection is evidence, never proof. */
export function runChecks(scan: ProjectScan): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck): void => {
    checks.push(check);
  };
  const forge = Object.keys(scan.forgePackages);
  const hasAdmin = '@forge-cms/admin' in scan.forgePackages;
  const hasAnyForge = forge.length > 0 || scan.agentKit !== null;

  if (!scan.hasPackageJson) {
    add({
      id: 'package-json',
      status: 'unknown',
      message: 'No readable package.json; nothing else can be assessed.'
    });
    return checks;
  }
  if (!hasAnyForge) {
    add({
      id: 'forge-installed',
      status: 'unknown',
      message: 'No @forge-cms/* dependency declared in this project (or its workspace members).'
    });
    return checks;
  }

  // 1. fixed family: one version everywhere
  const versions = new Set<string>();
  for (const name of FORGE_RUNTIME_PACKAGES) {
    for (const range of scan.dependencySections.get(name)?.values() ?? [])
      versions.add(exact(range));
    const installed = scan.forgePackages[name]?.installed;
    if (installed) versions.add(installed);
  }
  add(
    versions.size <= 1
      ? {
          id: 'family-versions',
          status: 'pass',
          message: 'All declared and installed @forge-cms/* packages share one version.'
        }
      : {
          id: 'family-versions',
          status: 'error',
          message: 'The @forge-cms/* packages form one fixed family; install matching versions.',
          evidence: [...versions].sort(),
          docs: 'support'
        }
  );

  // 2. admin runs on Angular 21 only
  const angular = scan.framework.angular;
  if (hasAdmin) {
    const angularMajor = angular ? major(angular) : undefined;
    add(
      angularMajor === undefined
        ? {
            id: 'admin-angular',
            status: 'unknown',
            message: '@forge-cms/admin is used but @angular/core is not declared here.'
          }
        : angularMajor === 21
          ? { id: 'admin-angular', status: 'pass', message: '@forge-cms/admin runs on Angular 21.' }
          : {
              id: 'admin-angular',
              status: 'error',
              message:
                '@forge-cms/admin supports Angular ^21.2.0 only; the admin is not supported on this Angular major.',
              evidence: [`@angular/core ${angular}`],
              docs: 'support'
            }
    );
    const missing = ['@angular/cdk', 'rxjs', '@voltui/components', 'lumen-icons'].filter(
      (name) => !scan.dependencySections.has(name)
    );
    add(
      missing.length === 0
        ? {
            id: 'admin-peers',
            status: 'pass',
            message: 'The admin peer dependencies are declared.'
          }
        : {
            id: 'admin-peers',
            status: 'warning',
            message: 'Declare the admin peer dependencies.',
            evidence: missing,
            docs: 'admin-ui'
          }
    );
  }

  // 3. the official Vite linker
  if (hasAdmin || '@forge-cms/angular' in scan.forgePackages) {
    if (scan.viteConfigs.length === 0) {
      add({
        id: 'vite-linker',
        status: 'unknown',
        message: 'No Vite config found at a conventional path.'
      });
    } else {
      const linked = scan.viteConfigs.some((text) =>
        /@forge-cms\/(angular|admin)\/vite/.test(text)
      );
      add(
        linked
          ? {
              id: 'vite-linker',
              status: 'pass',
              message: 'The official Forge Vite linker is configured.'
            }
          : {
              id: 'vite-linker',
              status: 'warning',
              message:
                'Add the official linker from @forge-cms/angular/vite (and @forge-cms/admin/vite).',
              docs: 'angular-quickstart'
            }
      );
    }
  }

  // 4. component input binding
  if (hasAdmin) {
    const configs = scan.sources.filter((s) =>
      /app\.config\.ts$|main\.ts$|app\.routes\.ts$/.test(s.path)
    );
    if (configs.length === 0) {
      add({
        id: 'component-input-binding',
        status: 'unknown',
        message: 'No app config file found at a conventional path.'
      });
    } else {
      add(
        configs.some((s) => /withComponentInputBinding\s*\(/.test(s.text))
          ? {
              id: 'component-input-binding',
              status: 'pass',
              message: 'withComponentInputBinding() is present.'
            }
          : {
              id: 'component-input-binding',
              status: 'warning',
              message:
                'The admin reads route data through component inputs: provideRouter(..., withComponentInputBinding()) is required.',
              docs: 'admin-ui'
            }
      );
    }
  }

  // 5. server-only packages and deep imports in browser code
  const serverImports: string[] = [];
  const deepImports: string[] = [];
  for (const source of scan.sources) {
    for (const match of source.text.matchAll(
      /from\s+['"](@forge-cms\/[a-z0-9-]+)(\/[^'"]*)?['"]/g
    )) {
      const name = match[1] ?? '';
      const sub = match[2] ?? '';
      if (/^\/(src|dist)(\/|$)/.test(sub)) deepImports.push(`${source.path}: ${name}${sub}`);
      if (source.browser && (SERVER_ONLY_PACKAGES as readonly string[]).includes(name)) {
        serverImports.push(`${source.path}: ${name}`);
      }
    }
  }
  if (scan.sources.some((s) => s.browser)) {
    add(
      serverImports.length === 0
        ? {
            id: 'browser-server-imports',
            status: 'pass',
            message: 'No server-only Forge package is imported from src/app.'
          }
        : {
            id: 'browser-server-imports',
            status: 'error',
            message:
              'Browser code imports server-only Forge packages (they would leak into the client bundle).',
            evidence: serverImports.slice(0, 10),
            docs: 'angular-client'
          }
    );
  }
  if (deepImports.length > 0) {
    add({
      id: 'deep-imports',
      status: 'error',
      message: 'Import Forge packages only through their entry points, never src/ or dist/.',
      evidence: deepImports.slice(0, 10),
      docs: 'reference'
    });
  }

  // 6. Cloudflare bindings
  if (scan.wrangler.found) {
    const { d1, r2 } = scan.wrangler.bindings;
    const hasDb = d1.includes('DB');
    const hasBucket = r2.includes('BUCKET');
    add(
      hasDb === hasBucket
        ? {
            id: 'cloudflare-bindings',
            status: hasDb ? 'pass' : 'unknown',
            message: hasDb
              ? 'D1 (DB) and R2 (BUCKET) are both bound.'
              : 'wrangler.toml binds neither D1 nor R2.'
          }
        : {
            id: 'cloudflare-bindings',
            status: 'warning',
            message: hasDb
              ? 'D1 is bound as DB but R2 BUCKET is missing.'
              : 'R2 is bound as BUCKET but D1 DB is missing.',
            docs: 'deployment'
          }
    );
    if (
      scan.wrangler.varNames.some((name) =>
        /^(AUTH_SECRET|CLOUDFLARE_ANALYTICS_TOKEN|CLOUDFLARE_API_TOKEN)$/.test(name)
      )
    ) {
      add({
        id: 'secret-in-vars',
        status: 'error',
        message:
          'A secret is declared in wrangler.toml [vars]; vars are committed and visible. Use `wrangler secret put` instead.',
        evidence: scan.wrangler.varNames.filter((name) =>
          /^(AUTH_SECRET|CLOUDFLARE_ANALYTICS_TOKEN|CLOUDFLARE_API_TOKEN)$/.test(name)
        )
      });
    }
  }

  // 7. in-memory adapters in a project that looks production-bound
  const runtimeText = scan.sources
    .filter((s) => /runtime\.ts$/.test(s.path))
    .map((s) => s.text)
    .join('\n');
  if (runtimeText.length > 0 && /InMemory(Database|Auth|Storage)Adapter/.test(runtimeText)) {
    const durable =
      scan.wrangler.bindings.d1.length > 0 || /LibSQL|D1DatabaseAdapter/.test(runtimeText);
    add(
      durable
        ? {
            id: 'in-memory-production',
            status: 'pass',
            message:
              'In-memory adapters are present alongside a durable adapter (assumed local-only fallback).'
          }
        : {
            id: 'in-memory-production',
            status: 'warning',
            message:
              'The runtime uses in-memory adapters and no durable adapter was detected; data is lost on restart.',
            docs: 'adapters'
          }
    );
  }

  // 8. analytics
  const a = scan.analytics;
  if (a.tracker || a.adminRoute || a.collectorRoute || a.summaryRoute) {
    if (a.tracker || a.collectorRoute) {
      add(
        !scan.wrangler.found
          ? {
              id: 'analytics-binding',
              status: 'unknown',
              message:
                'Analytics is wired but no wrangler.toml was found to confirm the ANALYTICS binding.'
            }
          : a.binding
            ? {
                id: 'analytics-binding',
                status: 'pass',
                message: 'The ANALYTICS Analytics Engine binding is declared.'
              }
            : {
                id: 'analytics-binding',
                status: 'warning',
                message:
                  'Analytics is enabled but wrangler.toml has no ANALYTICS [[analytics_engine_datasets]] binding; the collector will no-op.',
                docs: 'analytics'
              }
      );
    }
    if (a.adminRoute && !a.summaryRoute) {
      add({
        id: 'analytics-summary-route',
        status: 'warning',
        message:
          'The admin Analytics dashboard needs an admin-only GET /api/analytics/summary route and the read-side credentials.',
        docs: 'analytics'
      });
    }
  }

  // 9. deprecated admin options
  const layoutText = scan.sources
    .filter((s) => /ForgeAdminLayoutComponent/.test(s.text))
    .map((s) => s.text)
    .join('\n');
  if (/\b(logo|features)\s*:/.test(layoutText)) {
    add({
      id: 'deprecated-admin-options',
      status: 'warning',
      message: 'ForgeAdminConfig.logo and .features are deprecated no-ops.',
      docs: 'support'
    });
  }

  // 10. the agent kit is dev-only
  if (scan.agentKit && scan.agentKit.section !== 'devDependencies') {
    add({
      id: 'agent-dev-only',
      status: 'warning',
      message: '@forge-cms/agent is development tooling: declare it in devDependencies.',
      docs: 'support'
    });
  }
  void FORGE_AGENT_PACKAGE;
  return checks;
}

export function doctorProject(rootPath: string): DoctorReport {
  const scan = scanProject(rootPath);
  const checks = runChecks(scan);
  const summary: Record<CheckStatus, number> = { pass: 0, warning: 0, error: 0, unknown: 0 };
  for (const check of checks) summary[check.status] += 1;
  return {
    summary,
    checks,
    note: 'Static, Forge-specific checks only. They are evidence, not proof; run pnpm typecheck, pnpm lint and your tests for compiler and linter diagnostics.'
  };
}
