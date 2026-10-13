import { defineEventHandler } from 'h3';
import { handleCreate } from '@forge-cms/runtime';
import { apiContext } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleCreate(apiContext(event, 'collection'), {
    runtime,
    allowedRoles: ['admin', 'editor']
  });
});
