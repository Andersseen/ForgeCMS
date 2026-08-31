import {
  runDatabaseAdapterContractTests,
  runDatabaseAdapterConstraintContractTests,
  runDatabaseAdapterQueryContractTests
} from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from './in-memory.adapter.js';

runDatabaseAdapterContractTests(() => new InMemoryDatabaseAdapter());
runDatabaseAdapterConstraintContractTests(() => new InMemoryDatabaseAdapter());
runDatabaseAdapterQueryContractTests(() => new InMemoryDatabaseAdapter());
