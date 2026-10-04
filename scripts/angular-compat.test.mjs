import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  countMethodDefinitions,
  countUnlinkedDeclarations,
  findDivergentResolutions,
  findDuplicateStoreEntries,
  locatePackage,
  storeEntryName
} from './angular-compat.mjs';

test('storeEntryName reads scoped and unscoped pnpm store directories', () => {
  assert.equal(
    storeEntryName('@angular+common@21.2.10_@angular+core@21.2.10_rxjs@7.8.2'),
    '@angular/common'
  );
  assert.equal(storeEntryName('rxjs@7.8.2'), 'rxjs');
  assert.equal(storeEntryName('lock.yaml'), null);
});

test('a single copy of every singleton passes', () => {
  const entries = [
    '@angular+common@21.2.10_@angular+core@21.2.10_rxjs@7.8.2',
    '@angular+core@21.2.10_@angular+compiler@21.2.10_rxjs@7.8.2',
    '@angular+cdk@21.2.10_@angular+common@21.2.10_@angular+core@21.2.10',
    'rxjs@7.8.2'
  ];
  assert.deepEqual(findDuplicateStoreEntries(entries), []);
});

test('the 2026-09-17 incident layout fails: a second @angular/common for a mismatched exact peer', () => {
  // The app's 21.2.10 plus the copy pnpm installed to satisfy admin's exact `21.2.0` peer.
  const entries = [
    '@angular+common@21.2.10_@angular+core@21.2.10_rxjs@7.8.2',
    '@angular+common@21.2.0_@angular+core@21.2.0_rxjs@7.8.2',
    '@angular+core@21.2.10_rxjs@7.8.2',
    '@angular+core@21.2.0_rxjs@7.8.2'
  ];
  assert.deepEqual(
    findDuplicateStoreEntries(entries).map(({ name }) => name),
    ['@angular/common', '@angular/core']
  );
});

test('a private rxjs of the build tooling is not a store-level duplicate', () => {
  assert.deepEqual(findDuplicateStoreEntries(['rxjs@7.8.0', 'rxjs@7.8.2']), []);
});

test('the same version under two peer sets is two copies', () => {
  const entries = [
    '@angular+platform-browser@21.2.10_@angular+common@21.2.10_@angular+core@21.2.10',
    '@angular+platform-browser@21.2.10_@angular+animations@21.2.10_@angular+common@21.2.10'
  ];
  assert.equal(findDuplicateStoreEntries(entries).length, 1);
});

test('findDivergentResolutions reports a package two importers load from different places', () => {
  assert.deepEqual(
    findDivergentResolutions({
      app: { '@angular/common': '/store/common@21.2.10', rxjs: '/store/rxjs' },
      '@forge-cms/admin': { '@angular/common': '/store/common@21.2.0', rxjs: '/store/rxjs' }
    }),
    [
      {
        name: '@angular/common',
        paths: { '/store/common@21.2.10': ['app'], '/store/common@21.2.0': ['@forge-cms/admin'] }
      }
    ]
  );
  assert.deepEqual(findDivergentResolutions({ app: { rxjs: '/a' }, lib: { rxjs: '/a' } }), []);
});

test('locatePackage resolves through symlinks the way Node does', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-compat-'));
  try {
    const store = join(root, 'store', 'common');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'package.json'), '{}');
    const app = join(root, 'app');
    mkdirSync(join(app, 'node_modules', '@angular'), { recursive: true });
    symlinkSync(store, join(app, 'node_modules', '@angular', 'common'));
    mkdirSync(join(app, 'src', 'deep'), { recursive: true });

    assert.match(locatePackage(join(app, 'src', 'deep'), '@angular/common'), /store[/\\]common$/);
    assert.equal(locatePackage(app, '@angular/router'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('countUnlinkedDeclarations finds partial declarations the linker did not process', () => {
  // Minified output of an unlinked `@Injectable` (seen in a Vite build without the linker).
  const unlinked =
    'static ɵfac=yp({minVersion:"12.0.0",version:"21.2.10",ngImport:Da,type:Ut,deps:[]});' +
    'static ɵprov=vp({minVersion:"12.0.0",version:"21.2.10",ngImport:Da,type:Ut})';
  assert.equal(countUnlinkedDeclarations(unlinked), 2);
  // Unminified library output.
  assert.equal(
    countUnlinkedDeclarations(
      'i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.2.10", ngImport: i0, type: A })'
    ),
    1
  );
  // Linked code, and @angular/core's JIT symbol table, are not declarations.
  assert.equal(countUnlinkedDeclarations('static ɵfac=function(t){return new(t||A)}'), 0);
  assert.equal(countUnlinkedDeclarations('{ɵɵngDeclareFactory:yp,ɵɵngDeclareInjectable:vp}'), 0);
});

test('countMethodDefinitions counts definitions, not calls', () => {
  const one = 'class A{getBaseHrefFromDOM(){return x}} a.getBaseHrefFromDOM();';
  const two = `${one} class B{getBaseHrefFromDOM(){return y}}`;
  assert.equal(countMethodDefinitions(one, 'getBaseHrefFromDOM'), 1);
  assert.equal(countMethodDefinitions(two, 'getBaseHrefFromDOM'), 2);
});
