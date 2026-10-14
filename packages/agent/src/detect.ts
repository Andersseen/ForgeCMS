import { basename } from 'node:path';
import { FORGE_AGENT_PACKAGE, FORGE_RUNTIME_PACKAGES } from './forge-packages.js';
import { ProjectReader, cleanText } from './project-reader.js';

export interface ProjectDetection {
  root: string;
  forgePackages: Record<string, { declared: string; installed?: string; section: string }>;
  agentKit: { declared: string; section: string } | null;
  framework: { angular?: string; analog?: string; vite?: string };
  detectedProfile: 'cloudflare' | 'portable' | 'unknown';
  wrangler: {
    found: boolean;
    bindings: { d1: string[]; r2: string[]; analytics: string[] };
    varNames: string[];
  };
  admin: { detected: boolean; mount: string };
  localization: { detected: boolean };
  analytics: {
    tracker: boolean;
    binding: boolean;
    adminRoute: boolean;
    summaryRoute: boolean;
    collectorRoute: boolean;
  };
  warnings: string[];
}

/** Everything the scan found, including the (bounded) source texts the doctor inspects. Never returned to a caller. */
export interface ProjectScan extends ProjectDetection {
  sources: { path: string; text: string; browser: boolean }[];
  viteConfigs: string[];
  hasPackageJson: boolean;
  dependencySections: Map<string, Map<string, string>>;
}

const SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
] as const;
const WRANGLER_FILES = ['wrangler.toml'];
const VITE_FILES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
const CONVENTIONAL_SOURCES = [
  'src/app/app.routes.ts',
  'src/app/admin.routes.ts',
  'src/app/app.config.ts',
  'src/main.ts',
  'src/main.server.ts',
  'src/server/api/runtime.ts',
  'src/server/runtime.ts',
  'src/server/context.ts',
  'src/server/routes/api/analytics/collect.post.ts',
  'src/server/routes/api/analytics/summary.get.ts'
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Workspace member directories from `pnpm-workspace.yaml` / `package.json` `workspaces`, only `dir/*` patterns. */
function workspaceDirectories(
  reader: ProjectReader,
  rootPackage: Record<string, unknown>
): string[] {
  const patterns: string[] = [];
  const yaml = reader.readText('pnpm-workspace.yaml');
  if (yaml) {
    for (const match of yaml.matchAll(/^\s*-\s*['"]?([A-Za-z0-9_.@-]+)\/\*['"]?\s*$/gm)) {
      if (match[1]) patterns.push(match[1]);
    }
  }
  const workspaces = rootPackage['workspaces'];
  const list = Array.isArray(workspaces) ? workspaces : asRecord(workspaces)['packages'];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const match = typeof entry === 'string' ? /^([A-Za-z0-9_.@-]+)\/\*$/.exec(entry) : null;
      if (match?.[1]) patterns.push(match[1]);
    }
  }
  const dirs: string[] = [];
  for (const parent of [...new Set(patterns)].slice(0, 8)) {
    for (const entry of reader.list(parent)) {
      if (entry.kind === 'directory' && dirs.length < 40) dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs;
}

function parseWrangler(text: string): ProjectDetection['wrangler'] {
  const bindings = { d1: [] as string[], r2: [] as string[], analytics: [] as string[] };
  const varNames: string[] = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#') || line.length === 0) continue;
    const header = /^\[\[?([A-Za-z0-9_.-]+)\]?\]$/.exec(line);
    if (header) {
      section = header[1] ?? '';
      continue;
    }
    const binding = /^binding\s*=\s*["']([A-Za-z0-9_]+)["']/.exec(line);
    if (binding?.[1]) {
      if (section === 'd1_databases') bindings.d1.push(binding[1]);
      else if (section === 'r2_buckets') bindings.r2.push(binding[1]);
      else if (section === 'analytics_engine_datasets') bindings.analytics.push(binding[1]);
      continue;
    }
    // Only the NAME of a variable is kept; its value (a possible secret) is dropped here.
    const variable = /^([A-Za-z0-9_]+)\s*=/.exec(line);
    if (
      variable?.[1] &&
      (section === 'vars' || (section.startsWith('env.') && section.endsWith('.vars')))
    ) {
      varNames.push(variable[1]);
    }
  }
  return { found: true, bindings, varNames };
}

const BROWSER_ROOTS = ['src/app'];

export function scanProject(rootPath: string): ProjectScan {
  const reader = new ProjectReader(rootPath);
  const warnings: string[] = [];
  const rootPackage = asRecord(reader.readJson('package.json'));
  const hasPackageJson = Object.keys(rootPackage).length > 0;
  if (!hasPackageJson) warnings.push('No readable package.json at the project root.');

  const manifestDirs = ['.', ...workspaceDirectories(reader, rootPackage)];
  const dependencySections = new Map<string, Map<string, string>>();
  const declared = new Map<string, { version: string; section: string }>();
  for (const dir of manifestDirs) {
    const manifest = dir === '.' ? rootPackage : asRecord(reader.readJson(`${dir}/package.json`));
    for (const section of SECTIONS) {
      for (const [name, range] of Object.entries(asRecord(manifest[section]))) {
        if (typeof range !== 'string') continue;
        const sectionMap = dependencySections.get(name) ?? new Map<string, string>();
        sectionMap.set(`${dir}:${section}`, cleanText(range, 80));
        dependencySections.set(name, sectionMap);
        if (!declared.has(name)) declared.set(name, { version: cleanText(range, 80), section });
      }
    }
  }

  const forgePackages: ProjectDetection['forgePackages'] = {};
  for (const name of FORGE_RUNTIME_PACKAGES) {
    const entry = declared.get(name);
    if (!entry) continue;
    const installed = asRecord(reader.readJson(`node_modules/${name}/package.json`))['version'];
    forgePackages[name] = {
      declared: entry.version,
      section: entry.section,
      ...(typeof installed === 'string' && { installed: cleanText(installed, 40) })
    };
  }
  const agent = declared.get(FORGE_AGENT_PACKAGE);

  const framework: ProjectDetection['framework'] = {};
  const angular = declared.get('@angular/core');
  const analog = declared.get('@analogjs/platform');
  const vite = declared.get('vite');
  if (angular) framework.angular = angular.version;
  if (analog) framework.analog = analog.version;
  if (vite) framework.vite = vite.version;

  // Sources: conventional files plus bounded name-pattern discoveries, per manifest directory.
  const sources: ProjectScan['sources'] = [];
  const viteConfigs: string[] = [];
  let wranglerText: string | undefined;
  const seen = new Set<string>();
  const addSource = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = reader.readText(path);
    if (text === undefined) return;
    sources.push({ path, text, browser: BROWSER_ROOTS.some((root) => path.includes(`${root}/`)) });
  };
  for (const dir of manifestDirs) {
    const at = (rel: string): string => (dir === '.' ? rel : `${dir}/${rel}`);
    for (const file of WRANGLER_FILES) wranglerText ??= reader.readText(at(file));
    for (const file of VITE_FILES) {
      const text = reader.readText(at(file));
      if (text !== undefined) viteConfigs.push(text);
    }
    for (const rel of CONVENTIONAL_SOURCES) addSource(at(rel));
    for (const found of reader.find(at('src/app'), /\.ts$/, 4, 80)) {
      if (!/\.(test|spec)\.ts$/.test(found)) addSource(found);
    }
    for (const found of reader.find(
      at('src'),
      /(collections?|schema|admin|routes?)[\w.-]*\.ts$|\.page\.ts$/,
      3,
      40
    )) {
      if (!found.endsWith('.test.ts') && !found.endsWith('.spec.ts')) addSource(found);
    }
  }

  const wrangler = wranglerText
    ? parseWrangler(wranglerText)
    : { found: false, bindings: { d1: [], r2: [], analytics: [] }, varNames: [] };

  const all = sources.map((source) => source.text).join('\n');
  const hasPath = (suffix: string): boolean =>
    sources.some((source) => source.path.endsWith(suffix));
  const mountMatch =
    /basePath\s*:\s*['"](\/[A-Za-z0-9/_-]+)['"]/.exec(all) ??
    /\bMOUNT\s*=\s*['"](\/[A-Za-z0-9/_-]+)['"]/.exec(all);
  const adminDetected = '@forge-cms/admin' in forgePackages || /forgeAdmin\w*Routes\s*\(/.test(all);
  const pathMatch = /path\s*:\s*['"](admin|studio)['"][^}]*loadChildren/.exec(all);
  const mount =
    mountMatch?.[1] ??
    (pathMatch?.[1] ? `/${pathMatch[1]}` : adminDetected ? 'unknown' : 'unknown');

  const hasLibsql = declared.has('@libsql/client') || /LibSQL|libsql/i.test(all);
  const detectedProfile: ProjectDetection['detectedProfile'] =
    wrangler.bindings.d1.length > 0 || '@forge-cms/cloudflare' in forgePackages
      ? 'cloudflare'
      : '@forge-cms/s3' in forgePackages || hasLibsql
        ? 'portable'
        : 'unknown';

  return {
    root: basename(reader.root),
    forgePackages,
    agentKit: agent ? { declared: agent.version, section: agent.section } : null,
    framework,
    detectedProfile,
    wrangler,
    admin: { detected: adminDetected, mount: adminDetected ? mount : 'unknown' },
    localization: { detected: /\blocales\s*:/.test(all) && /\blocalized\s*:\s*true/.test(all) },
    analytics: {
      tracker: /provideForgeAnalytics\s*\(/.test(all),
      binding: wrangler.bindings.analytics.includes('ANALYTICS'),
      adminRoute: /forgeAdminAnalyticsRoutes\s*\(/.test(all),
      summaryRoute: hasPath('analytics/summary.get.ts'),
      collectorRoute: hasPath('analytics/collect.post.ts')
    },
    warnings,
    sources,
    viteConfigs,
    hasPackageJson,
    dependencySections
  };
}

/** The public, content-free summary returned by `forge_project_detect`. */
export function detectProject(rootPath: string): ProjectDetection {
  const {
    sources: _s,
    viteConfigs: _v,
    hasPackageJson: _h,
    dependencySections: _d,
    ...summary
  } = scanProject(rootPath);
  return summary;
}
