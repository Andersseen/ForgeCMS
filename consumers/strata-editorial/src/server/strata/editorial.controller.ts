import { Controller, Get, Post } from '@strata-sc/core';
import type {
  StrataAnalogGuard,
  StrataAnalogInterceptor,
  StrataAnalogRequest
} from '@strata-sc/analog';
import { assertCsrfSafe } from '@forge-cms/runtime';

import type { EditorialService } from '../../app/cms/editorial.service';
import { originRequest } from './request-env';

/**
 * ForgeCMS's public envelope, unchanged: item `{ data }`, list `{ data, meta }`, error `{ error }`.
 * Responses that depend on the caller's session are `private, no-store` and `Vary: Cookie`, so no shared
 * cache can serve one editor's draft to anybody else. Only the anonymous published list is cacheable.
 */
const PRIVATE = { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } as const;

function envelope(
  body: unknown,
  status = 200,
  headers: Record<string, string> = PRIVATE
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

const notFound = () => envelope({ error: 'Not found' }, 404);

/** Cross-site mutations riding on the session cookie are refused before the controller exists. */
export const csrfGuard: StrataAnalogGuard = ({ request }) => {
  try {
    assertCsrfSafe(originRequest(request));
    return { allow: true };
  } catch {
    return { allow: false, status: 403 };
  }
};

/**
 * An unexpected failure answers ForgeCMS's generic error envelope. The cause is logged by NAME only:
 * never its message, stack, the request, a database URL or a secret.
 */
export const safeErrors: StrataAnalogInterceptor = async (_context, next) => {
  try {
    return await next();
  } catch (error) {
    console.error(
      '[editorial] controller failure:',
      error instanceof Error ? error.name : typeof error
    );
    return envelope({ error: 'Internal server error' }, 500);
  }
};

/**
 * Transport only. Every decision (who the caller is, what they may read, whether they may publish) is made
 * by `EditorialService`, i.e. by ForgeCMS's session adapter and collection access rules. One instance per
 * request (Strata's request-scoped lifetime); its dependency is passed explicitly by the factory.
 */
@Controller('/api/editorial')
export class EditorialController {
  constructor(private readonly editorial: EditorialService) {}

  @Get('/posts')
  async list() {
    const docs = await this.editorial.listPublished();
    return envelope({ data: docs, meta: { total: docs.length } }, 200, {
      'cache-control': 'public, max-age=30'
    });
  }

  @Get('/posts/:id')
  async read(request: StrataAnalogRequest) {
    const editor = await this.editorial.resolveEditor(request.headers);
    const post = await this.editorial.readById(request.params['id'] ?? '', editor);
    return post ? envelope({ data: post }) : notFound();
  }

  @Post('/posts/:id/status')
  async changeStatus(request: StrataAnalogRequest) {
    const editor = await this.editorial.resolveEditor(request.headers);
    if (!editor) return envelope({ error: 'Unauthorized' }, 401);
    let body: unknown;
    try {
      body = await request.readJson();
    } catch {
      return envelope({ error: 'Invalid JSON body' }, 400);
    }
    const status =
      typeof body === 'object' && body !== null ? (body as { status?: unknown }).status : undefined;
    const result = await this.editorial.changeStatus(request.params['id'] ?? '', status, editor);
    switch (result.kind) {
      case 'changed':
        return envelope({ data: result.post });
      case 'unauthenticated':
        return envelope({ error: 'Unauthorized' }, 401);
      case 'invalid':
        return envelope({ error: "Invalid status: expected 'draft' or 'published'" }, 400);
      case 'not-found':
        return notFound();
    }
  }
}
