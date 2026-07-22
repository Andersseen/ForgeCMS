import { defineEventHandler } from 'h3';
import { describeCollections } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
  return { data: describeCollections(serverRuntime.getCollections()) };
});
