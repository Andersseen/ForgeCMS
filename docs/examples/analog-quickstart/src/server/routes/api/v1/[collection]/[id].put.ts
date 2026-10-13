import { defineEventHandler } from 'h3';
import { handleUpdate } from '@forge-cms/runtime';
import { apiContext } from '../../../../context';
import { getServerRuntime } from '../../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleUpdate(apiContext(event, 'collection', 'id'), {
    runtime,
    allowedRoles: ['admin', 'editor']
  });
});
