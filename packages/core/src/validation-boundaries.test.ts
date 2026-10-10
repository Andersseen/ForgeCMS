import { describe, expect, it, vi } from 'vitest';
import {
  assertValidIdentifier,
  consoleLogger,
  createSilentLogger,
  defineBlock,
  defineCollection,
  defineField,
  getLogger,
  getSystemFields,
  isSystemField,
  setLogger,
  validateCollection
} from './index';

const codes = (result: ReturnType<typeof validateCollection>) =>
  result.errors.map((e) => `${e.field}:${e.code}`);

describe('write-boundary validation (spec 089 critical CRUD evidence)', () => {
  const things = defineCollection({
    slug: 'things',
    fields: {
      handle: defineField.slug({ required: true, minLength: 3 }),
      contact: defineField.email(),
      kind: defineField.select({ options: ['a', 'b'] }),
      meta: defineField.json(),
      title: defineField.text({ localized: true })
    }
  });

  it('rejects unknown fields but tolerates the reserved system fields', () => {
    const unknown = validateCollection(things, { handle: 'abc', rogue: 1 });
    expect(codes(unknown)).toEqual(['rogue:unknown_field']);

    const system = validateCollection(things, {
      handle: 'abc',
      id: 'x',
      created_at: 'x',
      updated_at: 'x',
      _status: 'draft'
    });
    expect(system.valid).toBe(true);
  });

  it('distinguishes omitted from null for optional vs required fields', () => {
    expect(validateCollection(things, { handle: 'abc' }).valid).toBe(true);
    expect(validateCollection(things, { handle: 'abc', contact: null }).valid).toBe(true);
    expect(codes(validateCollection(things, { handle: null }))).toEqual(['handle:required']);
    expect(codes(validateCollection(things, {}))).toEqual(['handle:required']);
  });

  it('validates slug type, shape and length', () => {
    expect(codes(validateCollection(things, { handle: 7 }))).toEqual(['handle:type_slug']);
    expect(codes(validateCollection(things, { handle: 'Not A Slug' }))).toEqual([
      'handle:slug_format'
    ]);
    expect(codes(validateCollection(things, { handle: 'a--b' }))).toEqual(['handle:slug_format']);
    expect(codes(validateCollection(things, { handle: 'ab' }))).toEqual(['handle:minLength']);
  });

  it('validates email type and shape', () => {
    expect(codes(validateCollection(things, { handle: 'abc', contact: 5 }))).toEqual([
      'contact:type_email'
    ]);
    expect(codes(validateCollection(things, { handle: 'abc', contact: 'nobody@' }))).toEqual([
      'contact:email_format'
    ]);
    expect(validateCollection(things, { handle: 'abc', contact: 'a@b.co' }).valid).toBe(true);
  });

  it('validates select membership and type', () => {
    expect(codes(validateCollection(things, { handle: 'abc', kind: 1 }))).toEqual([
      'kind:type_select'
    ]);
    expect(codes(validateCollection(things, { handle: 'abc', kind: 'c' }))).toEqual([
      'kind:select_option'
    ]);
    expect(validateCollection(things, { handle: 'abc', kind: 'b' }).valid).toBe(true);
  });

  it('rejects json values that cannot be serialized, accepts structured ones', () => {
    expect(codes(validateCollection(things, { handle: 'abc', meta: () => 1 }))).toEqual([
      'meta:type_json'
    ]);
    expect(codes(validateCollection(things, { handle: 'abc', meta: Symbol('x') }))).toEqual([
      'meta:type_json'
    ]);
    expect(validateCollection(things, { handle: 'abc', meta: { a: [1, { b: null }] } }).valid).toBe(
      true
    );
  });

  it('requires localized text to be a locale map of strings', () => {
    expect(codes(validateCollection(things, { handle: 'abc', title: 'plain' }))).toEqual([
      'title:type_text'
    ]);
    expect(codes(validateCollection(things, { handle: 'abc', title: ['x'] }))).toEqual([
      'title:type_text'
    ]);
    expect(codes(validateCollection(things, { handle: 'abc', title: { en: 3 } }))).toEqual([
      'title:type_text'
    ]);
    expect(validateCollection(things, { handle: 'abc', title: { en: 'ok', es: 'si' } }).valid).toBe(
      true
    );
  });

  it('rejects non-object rows in array and blocks fields without throwing', () => {
    const hero = defineBlock({
      slug: 'hero',
      fields: { heading: defineField.text({ required: true }) }
    });
    const page = defineCollection({
      slug: 'pages',
      fields: {
        steps: defineField.array({ fields: { note: defineField.text() } }),
        sections: defineField.blocks({ blocks: [hero] })
      }
    });

    expect(codes(validateCollection(page, { steps: ['nope', null, 3] }))).toEqual([
      'steps.0:type_array',
      'steps.1:type_array',
      'steps.2:type_array'
    ]);
    expect(codes(validateCollection(page, { sections: 'nope' }))).toEqual(['sections:type_blocks']);
    expect(
      codes(validateCollection(page, { sections: ['nope', [], { blockType: 'hero' }] }))
    ).toEqual(['sections.0:type_blocks', 'sections.1:type_blocks', 'sections.2.heading:required']);
  });

  it('rejects non-parseable date inputs of every accepted input type', () => {
    const events = defineCollection({ slug: 'events', fields: { at: defineField.date() } });
    expect(codes(validateCollection(events, { at: 'not a date' }))).toEqual(['at:type_date']);
    expect(codes(validateCollection(events, { at: Number.NaN }))).toEqual(['at:type_date']);
    expect(codes(validateCollection(events, { at: true }))).toEqual(['at:type_date']);
    expect(validateCollection(events, { at: 1_700_000_000_000 }).valid).toBe(true);
    expect(validateCollection(events, { at: '2026-01-01' }).valid).toBe(true);
  });
});

describe('identifiers and logger primitives', () => {
  it('assertValidIdentifier throws for unsafe names and passes safe ones', () => {
    expect(() => assertValidIdentifier('good_name', 'test')).not.toThrow();
    expect(() => assertValidIdentifier('Bad-Name; DROP', 'collection "x"')).toThrow(
      /Invalid identifier "Bad-Name; DROP" in collection "x"/
    );
  });

  it('exposes the reserved system field set', () => {
    expect(isSystemField('id')).toBe(true);
    expect(isSystemField('title')).toBe(false);
    expect(getSystemFields().has('created_at')).toBe(true);
  });

  it('the default logger prefixes console output and can be swapped and silenced', () => {
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
    try {
      expect(getLogger()).toBe(consoleLogger);
      const logger = getLogger();
      logger.debug?.('d', 1);
      logger.info?.('i');
      logger.warn?.('w');
      logger.error('e');
      expect(spies[0]).toHaveBeenCalledWith('[forge] d', 1);
      expect(spies[1]).toHaveBeenCalledWith('[forge] i');
      expect(spies[2]).toHaveBeenCalledWith('[forge] w');
      expect(spies[3]).toHaveBeenCalledWith('[forge] e');

      const silent = createSilentLogger();
      setLogger(silent);
      expect(getLogger()).toBe(silent);
      getLogger().error('hidden');
      expect(spies[3]).toHaveBeenCalledTimes(1);
    } finally {
      setLogger(consoleLogger);
      spies.forEach((s) => s.mockRestore());
    }
  });
});
