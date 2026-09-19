import {
  runDatabaseAdapterContractTests,
  runDatabaseAdapterConstraintContractTests,
  runDatabaseAdapterQueryContractTests,
  runDatabaseAdapterConditionalWriteContractTests,
  runDatabaseAdapterAtomicWriteContractTests
} from '@forge-cms/testing/contracts';
import { InMemoryDatabaseAdapter } from './in-memory.adapter.js';

runDatabaseAdapterContractTests(() => new InMemoryDatabaseAdapter());
runDatabaseAdapterConstraintContractTests(() => new InMemoryDatabaseAdapter());
runDatabaseAdapterQueryContractTests(() => new InMemoryDatabaseAdapter());
runDatabaseAdapterConditionalWriteContractTests(() => new InMemoryDatabaseAdapter());
// InMemory does not check column names or collection registration (none of its methods does).
runDatabaseAdapterAtomicWriteContractTests(() => new InMemoryDatabaseAdapter(), {
  rejectsUnknownColumns: false
});
