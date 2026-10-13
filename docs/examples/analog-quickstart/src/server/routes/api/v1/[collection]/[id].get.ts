import { defineEventHandler } from 'h3';
import { handleRead } from '@forge-cms/runtime';
import { apiContext } from '../../../../context';
import { getServerRuntime } from '../../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleRead(apiContext(event, 'collection', 'id'), { runtime });
});
