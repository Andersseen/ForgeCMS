// @vitest-environment jsdom
import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ForgeCollectionWorkspaceComponent } from '@forge-cms/admin';
import { provideForgeCms } from '@forge-cms/angular';
import type { CollectionMeta, ForgeTransport } from '@forge-cms/angular';
import { DATASET, FIXTURE_VERSION, generateDataset } from '../src/dataset.js';
import { writeReport } from '../src/report.js';
import { summarise } from '../src/stats.js';

// Spec 089 — admin list rendering on the fixed dataset: a deterministic page of posts rendered by the real
// published `ForgeCollectionWorkspaceComponent` (the admin's content list) under Angular TestBed + jsdom.
// jsdom has no layout engine, so this measures Angular rendering work — template evaluation, change
// detection, DOM creation — not browser paint. It is a regression baseline for that work, nothing more.

const POSTS: CollectionMeta = {
  slug: 'posts',
  name: 'Posts',
  description: 'Fixture posts',
  drafts: true,
  useAsTitle: 'title',
  defaultColumns: ['category', 'rank', 'views', 'featured', 'author'],
  fieldDefinitions: [
    { name: 'title', kind: 'text', label: 'Title', required: true },
    {
      name: 'category',
      kind: 'select',
      label: 'Category',
      required: false,
      options: [...DATASET.categories]
    },
    { name: 'rank', kind: 'number', label: 'Rank', required: false },
    { name: 'views', kind: 'number', label: 'Views', required: false },
    { name: 'featured', kind: 'boolean', label: 'Featured', required: false },
    {
      name: 'author',
      kind: 'relation',
      label: 'Author',
      required: false,
      relation: { collection: 'authors', many: false }
    }
  ]
};

const WARMUP = 3;
const ITERATIONS = 25;

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

function transportFor(rows: Record<string, unknown>[]): ForgeTransport {
  return (request) => {
    const url = new URL(request.url, 'http://forge.test');
    if (url.pathname.endsWith('/auth/me'))
      return Promise.resolve(json({ data: { id: 'perf-admin', role: 'admin' } }));
    if (url.pathname.endsWith('/collections')) return Promise.resolve(json({ data: [POSTS] }));
    if (url.pathname.endsWith('/posts')) {
      return Promise.resolve(
        json({
          data: rows,
          meta: {
            collection: 'posts',
            count: rows.length,
            totalDocs: DATASET.posts,
            page: 1,
            totalPages: Math.ceil(DATASET.posts / rows.length),
            hasNextPage: true,
            hasPrevPage: false,
            limit: rows.length,
            offset: 0
          }
        })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
};

async function renderOnce(
  rows: Record<string, unknown>[]
): Promise<{ ms: number; rowCount: number; nodes: number }> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideForgeCms({ transport: transportFor(rows) }),
      { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: new BehaviorSubject(convertToParamMap({ collection: 'posts' })),
          parent: { paramMap: new BehaviorSubject(convertToParamMap({})) }
        }
      }
    ]
  });
  const started = performance.now();
  const fixture = TestBed.createComponent(ForgeCollectionWorkspaceComponent);
  const root = fixture.nativeElement as HTMLElement;
  let rowCount = 0;
  for (let attempt = 0; attempt < 400 && rowCount < rows.length; attempt++) {
    await tick();
    rowCount = root.querySelectorAll('volt-table-body volt-table-row').length;
  }
  const ms = performance.now() - started;
  const nodes = root.querySelectorAll('*').length;
  fixture.destroy();
  TestBed.resetTestingModule();
  return { ms, rowCount, nodes };
}

describe('admin list rendering', () => {
  it('renders fixture pages through the real admin workspace and records the cost', async () => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    const dataset = generateDataset().posts;
    const results: Record<string, unknown> = {};

    for (const size of [50, 500]) {
      const rows = dataset.slice(0, size).map((p) => ({ ...p, author: p['author'] }));
      for (let i = 0; i < WARMUP; i++) await renderOnce(rows);
      const samples: number[] = [];
      let last = { ms: 0, rowCount: 0, nodes: 0 };
      for (let i = 0; i < (size === 50 ? ITERATIONS : 8); i++) {
        last = await renderOnce(rows);
        samples.push(last.ms);
      }
      // The measurement is only meaningful if the page really rendered every row.
      expect(last.rowCount).toBe(size);
      results[`rows_${size}`] = {
        rows: last.rowCount,
        domNodes: last.nodes,
        renderMs: summarise(samples)
      };
    }

    writeReport('render.json', {
      schema: 1,
      fixture: {
        version: FIXTURE_VERSION,
        dataset: DATASET.posts + ' posts; the first N rendered'
      },
      environment: {
        node: process.version,
        renderer: 'Angular TestBed (zoneless) + jsdom — no layout/paint',
        component: '@forge-cms/admin ForgeCollectionWorkspaceComponent (dist)'
      },
      method: {
        warmup: WARMUP,
        iterations: { rows_50: ITERATIONS, rows_500: 8 },
        clock: 'performance.now()',
        measured: 'createComponent → every row present in the DOM'
      },
      renders: results
    });
  }, 300_000);
});
