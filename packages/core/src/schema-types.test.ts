/**
 * Compile-time coverage for the literal-preserving schema DSL (spec 076). Checked by `pnpm typecheck`
 * (`.test.ts` files are in `tsconfig.json`); `expectTypeOf` is a no-op at runtime and the
 * `@ts-expect-error` lines sit in a function that is never invoked.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defineCollection,
  defineField,
  defineGlobal,
  type AnyField,
  type CollectionData,
  type CollectionInput,
  type DateField,
  type FieldInputValue,
  type FieldOptionsOf,
  type FieldValue,
  type RelationField,
  type SelectField,
  type TextField
} from './index';

const author = defineField.relation({
  collection: 'users',
  many: true,
  access: { read: ['admin'] }
});
const status = defineField.select({ options: ['draft', 'live'], required: true });
const title = defineField.text({ required: true, localized: true });
const plain = defineField.text();
const when = defineField.date({ withTime: true });
const address = defineField.group({
  fields: { city: defineField.text({ required: true }), since: defineField.date() }
});

const events = defineCollection({
  slug: 'events',
  drafts: true,
  fields: { title, author, status, when, address }
});
const notes = defineCollection({ slug: 'notes', fields: { plain } });
const settings = defineGlobal({ slug: 'settings', drafts: true, fields: { plain } });

describe('literal-preserving field options (spec 076)', () => {
  it('keeps option literals in the field type', () => {
    expectTypeOf<FieldOptionsOf<typeof author>['collection']>().toEqualTypeOf<'users'>();
    expectTypeOf<FieldOptionsOf<typeof author>['many']>().toEqualTypeOf<true>();
    expectTypeOf<FieldOptionsOf<typeof author>['access']['read']>().toEqualTypeOf<['admin']>();
    expectTypeOf<FieldOptionsOf<typeof status>['options']>().toEqualTypeOf<['draft', 'live']>();
    expectTypeOf<FieldOptionsOf<typeof title>['required']>().toEqualTypeOf<true>();
    expectTypeOf<FieldOptionsOf<typeof title>['localized']>().toEqualTypeOf<true>();
    // A field declared without options has the empty options type.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    expectTypeOf<FieldOptionsOf<typeof plain>>().toEqualTypeOf<{}>();
  });

  it('stays assignable to the existing field aliases and to AnyField', () => {
    expectTypeOf(author).toExtend<RelationField>();
    expectTypeOf(status).toExtend<SelectField>();
    expectTypeOf(title).toExtend<TextField>();
    expectTypeOf(when).toExtend<DateField>();
    expectTypeOf(address).toExtend<AnyField>();
  });

  it('keeps contextual typing of access and hook callbacks', () => {
    const guarded = defineField.text({
      access: { read: ({ user }) => user?.role === 'admin' },
      hooks: { beforeChange: [({ value }) => (typeof value === 'string' ? value.trim() : value)] }
    });
    expect(guarded.kind).toBe('text');
  });

  it('marks a literal drafts: true collection or global', () => {
    expectTypeOf(events.drafts).toEqualTypeOf<true>();
    expectTypeOf(settings.drafts).toEqualTypeOf<true>();
    expectTypeOf(notes.drafts).toEqualTypeOf<boolean | undefined>();
  });
});

describe('date and input values (spec 076, Finding 24)', () => {
  it('reads a date as a string and writes a Date or a string', () => {
    expectTypeOf<FieldValue<typeof when>>().toEqualTypeOf<string>();
    expectTypeOf<FieldInputValue<typeof when>>().toEqualTypeOf<Date | string>();
    expectTypeOf<CollectionData<typeof events>['when']>().toEqualTypeOf<string>();
    expectTypeOf<CollectionData<typeof events>['address']>().toEqualTypeOf<{
      city: string;
      since: string;
    }>();
  });

  it('accepts Date and string dates, top-level and nested, in Local API input', () => {
    const input: CollectionInput<typeof events> = {
      when: new Date(),
      address: { city: 'Madrid', since: '2026-01-01' }
    };
    const iso: CollectionInput<typeof events> = { when: '2026-01-01T00:00:00.000Z' };
    expect([input, iso]).toHaveLength(2);
  });
});

// Never invoked: each line must fail to compile.
function rejected(): void {
  // @ts-expect-error - a select value outside its literal options is not a valid option type
  const badSelect: FieldOptionsOf<typeof status>['options'][number] = 'archived';
  // @ts-expect-error - a number is not a date input
  const badDate: FieldInputValue<typeof when> = 42;
  // @ts-expect-error - unknown option key for a text field
  defineField.text({ collection: 'users' });
  void badSelect;
  void badDate;
}
void rejected;
