import { describe, expect, it, vi } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { runBeforeChangeHooks, runAfterChangeHooks } from './hooks.js';

describe('runBeforeChangeHooks', () => {
  it('is a no-op when the collection has no hooks', async () => {
    const posts = defineCollection({ slug: 'posts', fields: { title: defineField.text() } });
    const result = await runBeforeChangeHooks(posts, { operation: 'create', data: { title: 'A' } });
    expect(result).toEqual({ title: 'A' });
  });

  it('runs multiple hooks in order, threading data through', async () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      hooks: {
        beforeChange: [
          (ctx) => ({ ...ctx.data, step1: true }),
          (ctx) => ({ ...ctx.data, step2: (ctx.data.step1 as boolean) === true })
        ]
      }
    });

    const result = await runBeforeChangeHooks(posts, { operation: 'create', data: { title: 'A' } });
    expect(result).toEqual({ title: 'A', step1: true, step2: true });
  });

  it('propagates a thrown error from a hook', async () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      hooks: {
        beforeChange: [
          () => {
            throw new Error('rejected by hook');
          }
        ]
      }
    });

    await expect(
      runBeforeChangeHooks(posts, { operation: 'create', data: { title: 'A' } })
    ).rejects.toThrow('rejected by hook');
  });

  it('passes previousData through on update', async () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      hooks: {
        beforeChange: [(ctx) => ({ ...ctx.data, sawPrevious: ctx.previousData?.title })]
      }
    });

    const result = await runBeforeChangeHooks(posts, {
      operation: 'update',
      data: { title: 'New' },
      previousData: { title: 'Old' }
    });
    expect(result.sawPrevious).toBe('Old');
  });
});

describe('runAfterChangeHooks', () => {
  it('is a no-op when the collection has no hooks', async () => {
    const posts = defineCollection({ slug: 'posts', fields: { title: defineField.text() } });
    await expect(
      runAfterChangeHooks(posts, { operation: 'create', data: {}, result: { id: '1' } })
    ).resolves.toBeUndefined();
  });

  it('receives the result of the write', async () => {
    const seen: unknown[] = [];
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      hooks: {
        afterChange: [(ctx) => void seen.push(ctx.result)]
      }
    });

    await runAfterChangeHooks(posts, {
      operation: 'create',
      data: { title: 'A' },
      result: { id: '1', title: 'A' }
    });
    expect(seen).toEqual([{ id: '1', title: 'A' }]);
  });

  it('does not throw when a hook fails, and logs instead', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      hooks: {
        afterChange: [
          () => {
            throw new Error('side effect failed');
          }
        ]
      }
    });

    await expect(
      runAfterChangeHooks(posts, { operation: 'create', data: {}, result: { id: '1' } })
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
