import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKILLS_DIR } from './package-info.js';

const names = readdirSync(SKILLS_DIR).sort();
const skill = (name: string): string =>
  readFileSync(new URL(`${name}/SKILL.md`, SKILLS_DIR), 'utf8');
const all = names.map((name) => ({ name, text: skill(name) }));

/** Every specifier a stable Forge consumer may import (roots + the retained subpaths). */
const PUBLIC_SPECIFIERS = new Set([
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/s3',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/angular',
  '@forge-cms/admin',
  '@forge-cms/testing',
  '@forge-cms/angular/server',
  '@forge-cms/angular/vite',
  '@forge-cms/admin/vite',
  '@forge-cms/testing/contracts'
]);

describe('skill pack structure', () => {
  it('ships the eight focused skills, each with name and description frontmatter', () => {
    expect(names).toEqual([
      'forgecms-admin',
      'forgecms-analytics',
      'forgecms-auth-access',
      'forgecms-cloudflare',
      'forgecms-content-modeling',
      'forgecms-localization',
      'forgecms-migrations-recovery',
      'forgecms-setup'
    ]);
    for (const { name, text } of all) {
      const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);
      expect(front, name).not.toBeNull();
      expect(front?.[1]).toBe(name);
      expect((front?.[2] ?? '').length).toBeGreaterThan(40);
    }
  });

  it('uses only public Forge specifiers (never src/, dist/ or the agent kit) in code and prose', () => {
    for (const { name, text } of all) {
      for (const match of text.matchAll(/@forge-cms\/[a-z0-9-]+(?:\/[a-z0-9/-]+)?/g)) {
        const specifier = match[0];
        const known = PUBLIC_SPECIFIERS.has(specifier) || specifier === '@forge-cms/agent';
        expect(known, `${name}: ${specifier}`).toBe(true);
      }
      for (const match of text.matchAll(/from '(@forge-cms\/[^']+)'/g)) {
        expect(PUBLIC_SPECIFIERS.has(match[1] ?? ''), `${name}: import ${match[1]}`).toBe(true);
      }
      expect(text, name).not.toMatch(/@forge-cms\/[a-z-]+\/(src|dist)\b/);
    }
  });

  it('names only MCP tools that exist and never invites unsafe practices', () => {
    const tools = new Set([
      'forge_project_detect',
      'forge_project_doctor',
      'forge_docs_search',
      'forge_support',
      'forge_runtime_metadata'
    ]);
    for (const { name, text } of all) {
      for (const match of text.matchAll(/\bforge_[a-z_]+\b/g))
        expect(tools.has(match[0]), `${name}: ${match[0]}`).toBe(true);
    }
    for (const { name, text } of all) {
      expect(text, name).not.toMatch(/\b0\.\d+\.\d+\b/);
      expect(text, name).not.toMatch(/AUTH_SECRET\s*=\s*['"]?[A-Za-z0-9]{8,}/);
    }
  });
});

describe('golden tasks: the sources carry the current contract', () => {
  const has = (name: string, ...needles: (string | RegExp)[]): void => {
    const text = skill(name);
    for (const needle of needles) {
      if (typeof needle === 'string')
        expect(text, `${name} should contain ${needle}`).toContain(needle);
      else expect(text, `${name} should match ${needle}`).toMatch(needle);
    }
  };

  it('A. a posts collection with drafts', () => {
    has(
      'forgecms-content-modeling',
      'drafts: true',
      'defineCollection',
      "from '@forge-cms/core'",
      '_status'
    );
  });

  it('B. title and description editable in Spanish and English', () => {
    has(
      'forgecms-localization',
      "locales: ['es', 'en']",
      'localized: true',
      'defineField.text',
      'defineField.textarea',
      'locale',
      '`locales`'
    );
    has(
      'forgecms-localization',
      /Refused at startup/,
      /localized `relation` or `upload`/,
      /Filtering or sorting/
    );
  });

  it('C. mount the admin at /studio', () => {
    has(
      'forgecms-admin',
      'basePath',
      '/studio',
      'withComponentInputBinding',
      'forgeAuthGuard',
      'signInPath',
      'forgeAdminAuthRoutes'
    );
  });

  it('D. an upload collection using R2', () => {
    has('forgecms-content-modeling', 'upload: true', 'defineField.upload');
    has('forgecms-cloudflare', 'r2_buckets', 'BUCKET', 'R2StorageAdapter');
  });

  it('E. enable client analytics in the admin', () => {
    has(
      'forgecms-analytics',
      'provideForgeAnalytics',
      'forgeAdminAnalyticsRoutes',
      'ANALYTICS',
      'AnalyticsEngineWriter',
      'NoopAnalyticsWriter',
      'CLOUDFLARE_ANALYTICS_TOKEN',
      'configured: false',
      'EXPERIMENTAL'
    );
    has('forgecms-analytics', /Never collect or store: IP address, email, Forge user id, cookies/);
  });

  it('F. editor access with user management admin-only', () => {
    has('forgecms-auth-access', 'editor', 'admin', 'overrideAccess: false', 'last admin');
    has('forgecms-admin', 'ForgeUsersWorkspaceComponent', "roles: ['admin']", 'admin-only');
  });

  it('G. a reviewed schema migration', () => {
    has(
      'forgecms-migrations-recovery',
      'defineMigration',
      'destructive',
      'allowDestructive',
      'planSchema',
      /backup/i,
      'Append-only',
      'never at application startup'
    );
  });

  it('H. deploy D1 + R2 safely', () => {
    has(
      'forgecms-cloudflare',
      'wrangler pages secret put AUTH_SECRET',
      'refuse to start',
      'FORGE_SSR_ORIGIN',
      'certified',
      'compatibility_date'
    );
    expect(skill('forgecms-cloudflare')).toMatch(/Do not write `env\.DB \? D1 : InMemory`/);
  });

  it('the setup skill picks a profile, forbids browser imports of server packages, and uses the official linker', () => {
    has(
      'forgecms-setup',
      'angularLinker',
      'withComponentInputBinding',
      'provideForgeCms',
      'server-only',
      'AUTH_SECRET',
      'D1',
      'libSQL'
    );
  });
});
