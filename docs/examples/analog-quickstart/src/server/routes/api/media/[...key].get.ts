import { defineEventHandler } from 'h3';
import { handleFile } from '@forge-cms/runtime';
import { apiContext } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleFile(apiContext(event, 'key'), { runtime });
});
