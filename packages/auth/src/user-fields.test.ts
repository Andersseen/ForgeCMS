import { describe, it, expect } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { generateCreateTableSql } from '@forge-cms/db';
import { AUTH_USER_FIELDS, withAuthFields } from './user-fields.js';

describe('withAuthFields', () => {
  const base = defineCollection({
    slug: 'users',
    fields: {
      email: defineField.email({ required: true }),
      name: defineField.text()
    }
  });

  it('adds the fields the auth adapter writes to', () => {
    const collection = withAuthFields(base);
    expect(collection.fields.passwordHash).toBeDefined();
    expect(collection.fields.passwordHash.kind).toBe('text');
  });

  it('keeps the declared fields and slug intact', () => {
    const collection = withAuthFields(base);
    expect(collection.slug).toBe('users');
    expect(collection.fields.email).toBe(base.fields.email);
    expect(collection.fields.name).toBe(base.fields.name);
  });

  it('lets an explicitly declared field win over the default', () => {
    const custom = defineField.text({ maxLength: 512 });
    const collection = withAuthFields(
      defineCollection({ slug: 'users', fields: { passwordHash: custom } })
    );
    expect(collection.fields.passwordHash).toBe(custom);
  });

  it('marks passwordHash unreadable and unwritable by every role', () => {
    // access.read/write: [] means "no role is on the allowlist", so filterReadableFields strips it.
    expect(AUTH_USER_FIELDS.passwordHash.options.access).toEqual({ read: [], write: [] });
  });

  it('does not mutate the input collection', () => {
    withAuthFields(base);
    expect('passwordHash' in base.fields).toBe(false);
  });

  // Real bug, found building spec 055's external-consumer fixture: `passwordHash` used to be
  // spread first, so it was the merged collection's *first* field — and `@forge-cms/admin`'s
  // relation picker searches whichever field comes first among text/slug/email kinds. A
  // `relation({ collection: 'users' })` field ended up searching by password hash instead of
  // email. `passwordHash` must land after every field the caller actually declared.
  it('orders passwordHash after the caller-declared fields, not before them', () => {
    const collection = withAuthFields(base);
    expect(Object.keys(collection.fields)).toEqual(['email', 'name', 'passwordHash']);
  });

  it('still puts an explicitly declared passwordHash wherever the caller put it', () => {
    const custom = defineField.text({ maxLength: 512 });
    const collection = withAuthFields(
      defineCollection({
        slug: 'users',
        fields: { passwordHash: custom, email: defineField.email({ required: true }) }
      })
    );
    expect(Object.keys(collection.fields)).toEqual(['passwordHash', 'email']);
  });

  // The actual bug this exists to fix: on a schemaless adapter an undeclared column is harmless,
  // but a real SQL adapter never creates it and every createUser/login fails at runtime with
  // "table users has no column named passwordHash".
  it('makes the generated users table include the passwordHash column', () => {
    expect(generateCreateTableSql(base)).not.toContain('passwordHash');
    expect(generateCreateTableSql(withAuthFields(base))).toContain('"passwordHash" TEXT');
  });
});
