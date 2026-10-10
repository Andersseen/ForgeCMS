import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import type { WriteGate } from './last-admin.js';
import { createWriteGate } from './last-admin.js';
import { codeOf, requirePair, winnerIndex } from './harness.js';

// Collection locale-merge contract (spec 067). Duck-typed on purpose — like every other contract in this
// package it must not import `@forge-cms/runtime`/`@forge-cms/db`.

type Row = Record<string, unknown>;

/** The subset of `ForgeCmsRuntime`'s Local API under test (trusted calls). */
export interface LocaleMergeRuntime {
  create(args: { collection: string; data: Row; locale?: string }): Promise<Row>;
  update(args: { collection: string; id: string; data: Row; locale?: string }): Promise<Row>;
}

export interface LocaleMergeHarness {
  /** `parties` runtimes, each over its **own adapter instance** of one store, each database wrapped with `gate.wrap(database)`. */
  contenders: LocaleMergeRuntime[];
  /** Raw, ungated reads of what committed. */
  database: { findById(collection: string, id: string): Promise<Row | null> };
}

/** Every contender's runtime must register (and `syncSchema()`) exactly {@link localeMergeCollections}`(prefix)`. */
export type LocaleMergeHarnessFactory = (options: {
  prefix: string;
  parties: number;
  gate: WriteGate;
}) => Promise<LocaleMergeHarness>;

/** `<p>_pages` with locales `en`/`es` and a localized `title`; `<p>_vpages` is the same, versioned. */
export function localeMergeCollections(prefix: string): CollectionDefinition[] {
  const fields = { title: defineField.text({ localized: true }), note: defineField.text() };
  return [
    defineCollection({ slug: `${prefix}_pages`, locales: ['en', 'es'], fields }),
    defineCollection({
      slug: `${prefix}_vpages`,
      locales: ['en', 'es'],
      versions: true,
      fields
    })
  ];
}

const TEST_TIMEOUT_MS = 30_000;
let prefixCounter = 0;

/**
 * Proves, on one backend, that two **independent** writers editing different locales of one collection
 * document at the same moment can never both report success while one locale is lost (spec 067). Both
 * are held at their write by a {@link WriteGate} — after each read the stored map and merged its own
 * locale into it — and released together. With no pause between the setup writes and the race, so a
 * same-millisecond `updated_at` cannot hide the conflict.
 */
export function runLocaleMergeContractTests(setup: LocaleMergeHarnessFactory) {
  describe('collection locale merges under independent writers (spec 067)', () => {
    for (const kind of ['pages', 'vpages'] as const) {
      it(
        `${kind === 'pages' ? 'plain' : 'versioned'}: one of two simultaneous locale edits commits, the other is a 409; no locale is lost`,
        async () => {
          const prefix = `lm${++prefixCounter}_${Date.now().toString(36)}`;
          const gate = createWriteGate({ timeoutMs: 10_000 });
          const harness = await setup({ prefix, parties: 2, gate });
          const [a, b] = requirePair(harness.contenders);
          const collection = `${prefix}_${kind}`;

          const page = await a.create({ collection, locale: 'en', data: { title: 'hello' } });
          const id = page.id as string;
          await a.update({ collection, id, locale: 'es', data: { title: 'hola' } });

          gate.arm(2);
          const outcomes = await Promise.allSettled([
            a.update({ collection, id, locale: 'en', data: { title: 'hi' } }),
            b.update({ collection, id, locale: 'es', data: { title: 'buenas' } })
          ]);
          gate.disarm();

          expect(outcomes.map(codeOf).sort()).toEqual(['CONCURRENT_MODIFICATION', 'ok']);
          const won = winnerIndex(outcomes); // 0: the `en` writer, 1: the `es` writer
          expect((await harness.database.findById(collection, id))?.title).toEqual(
            [
              { en: 'hi', es: 'hola' },
              { en: 'hello', es: 'buenas' }
            ][won]
          );

          await [
            () => b.update({ collection, id, locale: 'es', data: { title: 'buenas' } }),
            () => a.update({ collection, id, locale: 'en', data: { title: 'hi' } })
          ][won]!();
          expect((await harness.database.findById(collection, id))?.title).toEqual({
            en: 'hi',
            es: 'buenas'
          });
        },
        TEST_TIMEOUT_MS
      );
    }
  });
}
