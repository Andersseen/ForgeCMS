import { defineEventHandler } from 'h3';
import { handleList } from '@forge-cms/runtime';
import { apiContext } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleList(apiContext(event, 'collection'), { runtime });
});
