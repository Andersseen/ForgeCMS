import { runDatabaseAdapterContractTests } from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from './in-memory.adapter.js';

runDatabaseAdapterContractTests(() => new InMemoryDatabaseAdapter());
