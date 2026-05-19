import { runAuthAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryAuthAdapter } from './in-memory.adapter.js';

function createAdapter() {
  return new InMemoryAuthAdapter();
}

function setupAuthenticatedRequest(adapter: InMemoryAuthAdapter) {
  adapter.registerSession('test-token', {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      roles: ['admin']
    },
    expiresAt: new Date(Date.now() + 3600_000)
  });
  return new Request('https://forge.test', {
    headers: { authorization: 'Bearer test-token' }
  });
}

runAuthAdapterContractTests(createAdapter, setupAuthenticatedRequest);
