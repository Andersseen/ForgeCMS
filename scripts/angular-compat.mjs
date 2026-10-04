// Pure checks behind `scripts/verify-angular-compat.mjs` (spec 077, roadmap C03). Kept free of side
// effects so `scripts/angular-compat.test.mjs` can prove each one fails on the layout of the
// 2026-09-17 production incident: a second `@angular/common` installed for `@forge-cms/admin`'s
// subtree, bundled next to the app's, whose DOM adapter was never initialised (`PlatformLocation`
// → `getBaseHrefFromDOM` on `null`).

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Angular runtime packages that must be installed exactly once: a second copy is a second,
 * uninitialised runtime. Nothing in a consumer's install has a reason to carry another one.
 */
export const ANGULAR_RUNTIME_PACKAGES = [
  '@angular/common',
  '@angular/compiler',
  '@angular/core',
  '@angular/forms',
  '@angular/platform-browser',
  '@angular/router'
];

/**
 * Packages every browser-side importer (the app, Forge, VoltUI) must resolve to one directory. `rxjs`
 * is checked here rather than in the store: build tooling (`@angular-devkit/*`) pins its own private
 * copy, which never reaches the browser bundle.
 */
export const SINGLETON_PACKAGES = [...ANGULAR_RUNTIME_PACKAGES, 'rxjs'];

/**
 * The package name of a pnpm virtual-store directory (`node_modules/.pnpm/<entry>`), e.g.
 * `@angular+common@21.2.10_@angular+core@21.2.10_rxjs@7.8.2` → `@angular/common`. One directory is one
 * physical copy: the same version under two peer sets is two copies too.
 */
export function storeEntryName(entry) {
  const scoped = entry.startsWith('@');
  const at = entry.indexOf('@', scoped ? 1 : 0);
  if (at <= 0) return null;
  const name = entry.slice(0, at);
  return scoped ? name.replace('+', '/') : name;
}

/** `{ name, entries }` for every singleton package with more than one store directory. */
export function findDuplicateStoreEntries(entries, names = ANGULAR_RUNTIME_PACKAGES) {
  const byName = new Map();
  for (const entry of entries) {
    const name = storeEntryName(entry);
    if (name === null || !names.includes(name)) continue;
    byName.set(name, [...(byName.get(name) ?? []), entry]);
  }
  return [...byName]
    .filter(([, found]) => found.length > 1)
    .map(([name, found]) => ({ name, entries: found.sort() }));
}

/**
 * `resolutions` maps an importer label (`app`, `@forge-cms/admin`, …) to `{ [package]: realPath }`.
 * Returns `{ name, paths }` for every package that resolves to more than one real directory.
 */
export function findDivergentResolutions(resolutions) {
  const byName = new Map();
  for (const [importer, packages] of Object.entries(resolutions)) {
    for (const [name, path] of Object.entries(packages)) {
      if (path === null) continue;
      const paths = byName.get(name) ?? new Map();
      paths.set(path, [...(paths.get(path) ?? []), importer]);
      byName.set(name, paths);
    }
  }
  return [...byName]
    .filter(([, paths]) => paths.size > 1)
    .map(([name, paths]) => ({ name, paths: Object.fromEntries(paths) }));
}

/**
 * Where Node would load `name` from when imported by code in `fromDir` (walks `node_modules` upward,
 * like the resolver, without needing the package to export `./package.json`). `null` if absent.
 */
export function locatePackage(fromDir, name) {
  let dir = realpathSync(fromDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Partial-Ivy declarations left in a production bundle — each one is a `JIT compiler unavailable`
 * crash. Matched by their metadata (`{minVersion:"…",version:"…",ngImport:…}`), which survives
 * minification, rather than by the `ɵɵngDeclare*` names: minified calls are renamed, and the names do
 * appear legitimately in `@angular/core`'s JIT symbol table.
 */
export function countUnlinkedDeclarations(code) {
  return (
    code.match(
      /minVersion\s*:\s*["'][\d.]+["']\s*,\s*version\s*:\s*["'][^"']+["']\s*,\s*ngImport\s*:/g
    ) ?? []
  ).length;
}

/**
 * Method definitions of `name` (not calls): `getBaseHrefFromDOM(){…}` counts, `.getBaseHrefFromDOM()`
 * does not. Two definitions in one bundle means two copies of the class that defines it.
 */
export function countMethodDefinitions(code, name) {
  const pattern = new RegExp(`(?<![.\\w$])${name}\\s*\\([^()]*\\)\\s*\\{`, 'g');
  return (code.match(pattern) ?? []).length;
}
