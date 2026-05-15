import { describe, expect, it } from 'vitest';
import type { StorageObject } from './index';

describe('StorageAdapter contracts', () => {
  it('describes stored objects', () => {
    const object: StorageObject = {
      key: 'uploads/avatar.png',
      contentType: 'image/png'
    };

    expect(object.key).toBe('uploads/avatar.png');
  });
});
