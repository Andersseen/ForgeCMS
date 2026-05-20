import { runStorageAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryStorageAdapter } from './in-memory.adapter.js';

runStorageAdapterContractTests(() => new InMemoryStorageAdapter());
