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

  // The actual bug this exists to fix: on a schemaless adapter an undeclared column is harmless,
  // but a real SQL adapter never creates it and every createUser/login fails at runtime with
  // "table users has no column named passwordHash".
  it('makes the generated users table include the passwordHash column', () => {
    expect(generateCreateTableSql(base)).not.toContain('passwordHash');
    expect(generateCreateTableSql(withAuthFields(base))).toContain('"passwordHash" TEXT');
  });
});
