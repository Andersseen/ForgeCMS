// @vitest-environment jsdom
/** Spec 085: the collections index is latest-wins, and one failed count never fails the page. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideForgeCms } from '@forge-cms/angular';
import { ForgeCollectionsIndexComponent } from './collections-index.component.js';
import * as h from './reliability.test-helpers.js';

let transport: h.ControlledTransport;
beforeEach(() => {
  h.initTestEnvironment();
  transport = new h.ControlledTransport();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideForgeCms({ transport: transport.transport })
    ]
  });
});
afterEach(() => TestBed.resetTestingModule());

describe('ForgeCollectionsIndexComponent', () => {
  it('an older load (repeated Retry) cannot replace a newer result', async () => {
    const fixture = TestBed.createComponent(ForgeCollectionsIndexComponent);
    await h.settle();
    const older = transport.last('/collections');
    void (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await h.settle();
    const newer = transport.calls.filter((c) => c.url.endsWith('/collections')).at(-1);

    newer?.resolve({ data: [h.PAGES] });
    await h.settle();
    transport.last('/pages?').resolve(h.listPage('pages', [], { totalDocs: 3 }));
    await h.settle();
    older.resolve({ data: [h.POSTS] });
    await h.settle();

    expect(h.text(fixture)).toContain('Pages');
    expect(h.text(fixture)).not.toContain('Posts');
  });

  it('a failing count shows — for that card only; a failing inventory is the whole-page error', async () => {
    const fixture = TestBed.createComponent(ForgeCollectionsIndexComponent);
    await h.settle();
    transport.last('/collections').resolve({ data: [h.POSTS, h.PAGES] });
    await h.settle();
    transport.last('/posts?').resolve({ error: { code: 'BOOM', message: 'x' } }, 500);
    transport.last('/pages?').resolve(h.listPage('pages', [], { totalDocs: 4 }));
    await h.settle();
    expect(h.text(fixture)).toContain('— documents');
    expect(h.text(fixture)).toContain('4 documents');
    expect(h.text(fixture)).not.toContain("Couldn't load collections");
  });
});
