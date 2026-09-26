import { describe, expect, it } from 'vitest';
import { toSubmitPayload } from './form-payload.js';

describe('toSubmitPayload (spec 063)', () => {
  it('drops Forge-owned metadata and keeps content and _status', () => {
    expect(
      toSubmitPayload({
        id: 'doc-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        _storageKey: 'media/a.pdf',
        _status: 'published',
        title: 'Hello',
        tags: ['a']
      })
    ).toEqual({ _status: 'published', title: 'Hello', tags: ['a'] });
  });
});
