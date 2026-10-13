import { defineEventHandler } from 'h3';
import { describeCollections } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../runtime';

// Schema metadata for the admin. Fields no role can read or write (password hashes) are not listed.
export default defineEventHandler(async () => {
  const runtime = await getServerRuntime();
  return { data: describeCollections(runtime.getCollections()) };
});
