import { describe, expect, it } from 'vitest';
import { defineField, defineGlobal } from '@forge-cms/core';
import type { GlobalDefinition } from '@forge-cms/core';
import type { WriteGate } from './last-admin.js';
import { createWriteGate } from './last-admin.js';
import { codeOf, requirePair, winnerIndex } from './harness.js';

// Global document lifecycle contract (spec 066). Duck-typed on purpose — like every other contract in
// this package it must not import `@forge-cms/runtime`/`@forge-cms/db`.

type Row = Record<string, unknown>;

/** The subset of `ForgeCmsRuntime`'s Local API under test (trusted calls). */
export interface GlobalLifecycleRuntime {
  updateGlobalDocument(args: { global: string; data: Row; locale?: string }): Promise<Row>;
  getGlobalDocument(args: { global: string; locale?: string }): Promise<Row | null>;
}

/** Raw, **ungated** database access to the same store, for reading what really committed. */
export interface GlobalLifecycleDatabase {
  findById(collection: string, id: string): Promise<Row | null>;
}

export interface GlobalLifecycleHarness {
  /** `parties` runtimes, each over its **own adapter instance** of one store, each database wrapped with `gate.wrap(database)`. */
  contenders: GlobalLifecycleRuntime[];
  database: GlobalLifecycleDatabase;
}

/**
 * Builds the harness. Every contender's runtime must register (and `syncSchema()`) exactly
 * {@link globalLifecycleGlobals}`(prefix)` as its globals.
 */
export type GlobalLifecycleHarnessFactory = (options: {
  /** A prefix no other test has used, so a persistent shared store needs no cleanup. */
  prefix: string;
  parties: number;
  gate: WriteGate;
}) => Promise<GlobalLifecycleHarness>;

/**
 * The global the suite runs against: `<p>_site`, with `drafts`, locales `en`/`es`, a required `title`,
 * a `theme` with a default, a plain `footer` and a localized `tagline`.
 */
export function globalLifecycleGlobals(prefix: string): GlobalDefinition[] {
  return [
    defineGlobal({
      slug: `${prefix}_site`,
      drafts: true,
      locales: ['en', 'es'],
      fields: {
        title: defineField.text({ required: true }),
        theme: defineField.text({ defaultValue: 'light' }),
        footer: defineField.text(),
        tagline: defineField.text({ localized: true })
      }
    })
  ];
}

const TEST_TIMEOUT_MS = 30_000;
let prefixCounter = 0;

/**
 * Proves, on one backend, that a global's document survives **independent** writers (spec 066): two
 * simultaneous first writes, two simultaneous edits of different locales, and two simultaneous partial
 * edits of different fields. Each scenario holds both writers at their write with a {@link WriteGate} —
 * after each one read the row and decided what to write — then releases them together, and reads the
 * committed row back. Never a lost write that reported success, never an internal error.
 */
export function runGlobalLifecycleContractTests(setup: GlobalLifecycleHarnessFactory) {
  describe('global document lifecycle under independent writers (spec 066)', () => {
    async function prepare() {
      const prefix = `gl${++prefixCounter}_${Date.now().toString(36)}`;
      const gate = createWriteGate({ timeoutMs: 10_000 });
      const harness = await setup({ prefix, parties: 2, gate });
      const [a, b] = requirePair(harness.contenders);
      const global = `${prefix}_site`;
      const row = () => harness.database.findById(`_global_${global}`, 'global');
      return { gate, a, b, global, row };
    }

    it(
      'two simultaneous first writes: exactly one commits, the other is a 409 and writes nothing',
      async () => {
        const { gate, a, b, global, row } = await prepare();

        gate.arm(2);
        const outcomes = await Promise.allSettled([
          a.updateGlobalDocument({ global, data: { title: 'A' } }),
          b.updateGlobalDocument({ global, data: { title: 'B' } })
        ]);
        gate.disarm();

        const codes = outcomes.map(codeOf).sort();
        expect(codes).toEqual(['CONCURRENT_MODIFICATION', 'ok']);
        const won = winnerIndex(outcomes);
        const winner = ['A', 'B'][won];
        expect(await row()).toMatchObject({ title: winner, theme: 'light', _status: 'draft' });

        // The loser's retry is an ordinary partial update of the row the winner created.
        await [b, a][won]!.updateGlobalDocument({ global, data: { footer: 'f' } });
        expect(await row()).toMatchObject({ title: winner, footer: 'f' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'two simultaneous edits of different locales: one commits, the other is a 409; no locale is lost',
      async () => {
        const { gate, a, b, global, row } = await prepare();
        await a.updateGlobalDocument({ global, data: { title: 'T' } });
        await a.updateGlobalDocument({ global, locale: 'en', data: { tagline: 'hello' } });
        // No pause: the edits below race the row just written, inside the same millisecond if the
        // backend is fast enough — the CAS must still tell them apart.
        await a.updateGlobalDocument({ global, locale: 'es', data: { tagline: 'hola' } });

        gate.arm(2);
        const outcomes = await Promise.allSettled([
          a.updateGlobalDocument({ global, locale: 'en', data: { tagline: 'hi' } }),
          b.updateGlobalDocument({ global, locale: 'es', data: { tagline: 'buenas' } })
        ]);
        gate.disarm();

        expect(outcomes.map(codeOf).sort()).toEqual(['CONCURRENT_MODIFICATION', 'ok']);
        const won = winnerIndex(outcomes); // 0: the `en` writer, 1: the `es` writer
        expect((await row())?.tagline).toEqual(
          [
            { en: 'hi', es: 'hola' },
            { en: 'hello', es: 'buenas' }
          ][won]
        );

        // Retried against the fresh row, the loser's locale lands and the winner's stays.
        await [
          () => b.updateGlobalDocument({ global, locale: 'es', data: { tagline: 'buenas' } }),
          () => a.updateGlobalDocument({ global, locale: 'en', data: { tagline: 'hi' } })
        ][won]!();
        expect((await row())?.tagline).toEqual({ en: 'hi', es: 'buenas' });
        expect(await a.getGlobalDocument({ global, locale: 'es' })).toMatchObject({
          tagline: 'buenas'
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'two simultaneous partial edits of different fields: both commit, neither resets the other',
      async () => {
        const { gate, a, b, global, row } = await prepare();
        await a.updateGlobalDocument({
          global,
          data: { title: 'T', theme: 'dark', _status: 'published' }
        });

        gate.arm(2);
        const outcomes = await Promise.allSettled([
          a.updateGlobalDocument({ global, data: { title: 'T2' } }),
          b.updateGlobalDocument({ global, data: { footer: 'F' } })
        ]);
        gate.disarm();

        expect(outcomes.map(codeOf)).toEqual(['ok', 'ok']);
        expect(await row()).toMatchObject({
          title: 'T2',
          footer: 'F',
          theme: 'dark',
          _status: 'published'
        });
      },
      TEST_TIMEOUT_MS
    );
  });
}
