import { defineEventHandler, getRouterParam, getQuery } from 'h3';
import { getServerRuntime } from '../../../../../../api/runtime';
import { createAuthRequest } from '../../../../../../api/auth-request';
import { exportTranslationCatalog } from '../../../../../../translations/export-service';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  try {
    await runtime.adapters.auth.requireAuth(createAuthRequest(event));
  } catch {
    return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  const projectSlug = getRouterParam(event, 'project');
  const locale = getRouterParam(event, 'locale');

  if (!projectSlug || !locale) {
    return new Response(
      JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Missing project or locale parameter' } }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  try {
    const query = getQuery(event);
    const fallback = query['fallback'] === 'source' ? 'source' : 'none';

    const catalog = await exportTranslationCatalog(runtime, projectSlug, locale, {
      fallback: fallback as 'none' | 'source'
    });

    return new Response(JSON.stringify(catalog, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${projectSlug}.${locale}.json"`
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    return new Response(
      JSON.stringify({ error: { code: 'EXPORT_FAILED', message } }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
});
