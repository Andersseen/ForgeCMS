import { afterEach, describe, expect, it } from 'vitest';
import { detectProject } from './detect.js';
import { SECRET, clientProject, makeProject } from './test-support.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});
const project = (files: Record<string, string | object>) => {
  const made = makeProject(files);
  cleanups.push(made.cleanup);
  return made.root;
};

describe('detectProject', () => {
  it('summarises an Angular/Analog Cloudflare client site without leaking content', () => {
    const result = detectProject(project(clientProject()));
    expect(result.forgePackages['@forge-cms/core']?.declared).toBe('1.0.0-rc.0');
    expect(result.agentKit?.section).toBe('devDependencies');
    expect(result.framework).toEqual({ angular: '21.2.10', analog: '2.5.2', vite: '7.1.4' });
    expect(result.detectedProfile).toBe('cloudflare');
    expect(result.wrangler.bindings).toEqual({
      d1: ['DB'],
      r2: ['BUCKET'],
      analytics: ['ANALYTICS']
    });
    expect(result.wrangler.varNames).toEqual(['FORGE_SSR_ORIGIN']);
    expect(result.admin).toEqual({ detected: true, mount: '/studio' });
    expect(result.localization.detected).toBe(true);
    expect(result.analytics).toEqual({
      tracker: true,
      binding: true,
      adminRoute: true,
      summaryRoute: true,
      collectorRoute: true
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('00000000-0000');
    expect(text).not.toContain('client.example');
  });

  it('reports the installed version from node_modules when present', () => {
    const result = detectProject(
      project({
        'package.json': { dependencies: { '@forge-cms/core': '^1.0.0-rc.0' } },
        'node_modules/@forge-cms/core/package.json': { version: '1.0.0-rc.0' }
      })
    );
    expect(result.forgePackages['@forge-cms/core']).toMatchObject({
      declared: '^1.0.0-rc.0',
      installed: '1.0.0-rc.0'
    });
  });

  it('handles a server-only portable project', () => {
    const result = detectProject(
      project({
        'package.json': {
          dependencies: {
            '@forge-cms/core': '1',
            '@forge-cms/db': '1',
            '@forge-cms/s3': '1',
            '@libsql/client': '0.17.3'
          }
        }
      })
    );
    expect(result.detectedProfile).toBe('portable');
    expect(result.admin).toEqual({ detected: false, mount: 'unknown' });
    expect(result.analytics.tracker).toBe(false);
  });

  it('reads workspace member manifests in a monorepo', () => {
    const result = detectProject(
      project({
        'package.json': { name: 'mono', private: true },
        'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'libs/*'\n",
        'apps/web/package.json': {
          dependencies: { '@forge-cms/angular': '1.0.0', '@angular/core': '21.0.0' }
        },
        'libs/server/package.json': { dependencies: { '@forge-cms/runtime': '1.0.0' } }
      })
    );
    expect(Object.keys(result.forgePackages).sort()).toEqual([
      '@forge-cms/angular',
      '@forge-cms/runtime'
    ]);
    expect(result.framework.angular).toBe('21.0.0');
  });

  it('survives a missing or malformed package.json', () => {
    const missing = detectProject(project({ 'README.md': 'hi' }));
    expect(missing.warnings.join(' ')).toMatch(/package\.json/);
    expect(missing.forgePackages).toEqual({});
    const bad = detectProject(project({ 'package.json': '{oops' }));
    expect(bad.forgePackages).toEqual({});
  });

  it('strips control characters from project-controlled strings', () => {
    const result = detectProject(
      project({
        'package.json': { dependencies: { '@forge-cms/core': '1.0.0\u001b[2J\u0007evil' } }
      })
    );
    const declared = result.forgePackages['@forge-cms/core']?.declared ?? '';
    expect([...declared].every((char) => (char.codePointAt(0) ?? 0) >= 0x20)).toBe(true);
  });

  it('does not take a path argument and never reads .env or .dev.vars', () => {
    const result = detectProject(project(clientProject()));
    expect(JSON.stringify(result)).not.toContain('AUTH_SECRET');
  });
});
