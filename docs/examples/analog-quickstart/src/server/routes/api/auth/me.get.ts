import { defineEventHandler } from 'h3';
import { handleMe } from '@forge-cms/runtime';
import { apiContext } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleMe(apiContext(event), { runtime });
});
