import { defineEventHandler } from 'h3';
import { handleDelete } from '@forge-cms/runtime';
import { apiContext } from '../../../../context';
import { getServerRuntime } from '../../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleDelete(apiContext(event, 'collection', 'id'), { runtime, allowedRoles: ['admin'] });
});
