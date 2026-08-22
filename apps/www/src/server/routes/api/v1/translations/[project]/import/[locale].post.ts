import { defineEventHandler, getRouterParam, readBody } from 'h3';
import { getServerRuntime } from '../../../../../../api/runtime';
import { createAuthRequest } from '../../../../../../api/auth-request';
import { importTranslationCatalog } from '../../../../../../translations/import-service';

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
    const catalog = (await readBody(event)) as Record<string, unknown>;

    if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Request body must be a JSON object' } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const result = await importTranslationCatalog(runtime, projectSlug, locale, catalog);

    return new Response(JSON.stringify({ data: result }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return new Response(
      JSON.stringify({ error: { code: 'IMPORT_FAILED', message } }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
});
