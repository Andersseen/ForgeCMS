import { describe, expect, it } from 'vitest';
import type { AuthSession } from './index';

describe('AuthAdapter contracts', () => {
  it('supports a typed auth session', () => {
    const session: AuthSession = {
      user: {
        id: 'user-1',
        email: 'user@example.com'
      }
    };

    expect(session.user.id).toBe('user-1');
  });
});
