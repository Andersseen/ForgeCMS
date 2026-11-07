import '@strata-sc/server-components/server-only';

import type { CmsUser, RichTextNode } from '@forge-cms/core';
import { isForgeError } from '@forge-cms/runtime';

import type { EditorialRuntime } from './runtime';

/** The authenticated caller, as ForgeCMS's session adapter resolved it from THIS request's headers. */
export interface Editor {
  readonly id: string;
  readonly role: string;
  readonly name: string;
}

export type PostStatus = 'draft' | 'published';

/**
 * The public projection of a post. It is the ONLY shape that leaves the service toward HTML, JSON or a
 * client island: no author email, no session data, no internal fields, no raw database row.
 */
export interface PostView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly paragraphs: readonly string[];
  readonly status: PostStatus;
  readonly byline: string;
  readonly updatedAt: string;
  /** Whether the CALLER may change this post's status (decided by ForgeCMS's update access rule). */
  readonly canChangeStatus: boolean;
}

export interface PostSummary {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly byline: string;
}

export type StatusChange =
  | { readonly kind: 'changed'; readonly post: PostView }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid' };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Server-side application service. It owns no business rule of its own: identity comes from ForgeCMS's
 * session adapter, visibility and write permission from the collection access rules, and every read/write
 * goes through the Local API with `overrideAccess: false` and the resolved user. Constructed per request
 * with an explicit runtime dependency (no Angular DI, so it runs on workerd too).
 */
export class EditorialService {
  constructor(private readonly runtime: EditorialRuntime) {}

  /**
   * Resolves the caller from the request's own session cookie / bearer token. Anything else that might
   * look like identity (a query parameter, an `x-user` header, the URL) is ignored by construction.
   */
  async resolveEditor(headers: Headers): Promise<Editor | null> {
    const auth = this.runtime.adapters.auth;
    if (!auth.requireAuth) return null;
    try {
      const user = await auth.requireAuth(new Request('http://editorial.internal/', { headers }));
      return toEditor(user);
    } catch {
      return null;
    }
  }

  async listPublished(limit = 20): Promise<PostSummary[]> {
    const result = await this.runtime.find({
      collection: 'posts',
      user: null,
      overrideAccess: false,
      status: 'published',
      sort: 'updated_at',
      order: 'desc',
      limit
    });
    return Promise.all(
      result.docs.map(async (doc) => {
        const record = doc as Record<string, unknown>;
        return {
          slug: String(record['slug'] ?? ''),
          title: String(record['title'] ?? ''),
          summary: String(record['summary'] ?? ''),
          byline: await this.byline(record['author'])
        };
      })
    );
  }

  /**
   * One post as the caller may see it, or `null`. Anonymous callers and editors reading somebody else's
   * draft both get `null`: a protected draft is indistinguishable from a missing post.
   */
  async readBySlug(slug: string, editor: Editor | null): Promise<PostView | null> {
    if (!SLUG.test(slug)) return null;
    const doc = await this.runtime.findOne({
      collection: 'posts',
      where: { slug: { eq: slug } },
      user: toCmsUser(editor),
      overrideAccess: false,
      status: editor ? 'all' : 'published'
    });
    return doc ? this.toView(doc as Record<string, unknown>, editor) : null;
  }

  async readById(id: string, editor: Editor | null): Promise<PostView | null> {
    if (!ID.test(id)) return null;
    try {
      const doc = await this.runtime.findByID({
        collection: 'posts',
        id,
        user: toCmsUser(editor),
        overrideAccess: false
      });
      return this.toView(doc as Record<string, unknown>, editor);
    } catch (error) {
      if (isForgeError(error) && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }
  }

  /** Publish or unpublish. ForgeCMS's `update` access rule decides; a refusal is reported as not-found. */
  async changeStatus(id: string, status: unknown, editor: Editor | null): Promise<StatusChange> {
    if (!editor) return { kind: 'unauthenticated' };
    if (status !== 'draft' && status !== 'published') return { kind: 'invalid' };
    // Read first, as the caller: an id the caller cannot see must not reveal whether it exists.
    if (!(await this.readById(id, editor))) return { kind: 'not-found' };
    try {
      const doc = await this.runtime.update({
        collection: 'posts',
        id,
        data: { _status: status },
        user: toCmsUser(editor),
        overrideAccess: false
      });
      return { kind: 'changed', post: await this.toView(doc as Record<string, unknown>, editor) };
    } catch (error) {
      if (isForgeError(error) && (error.status === 403 || error.status === 404)) {
        return { kind: 'not-found' };
      }
      if (isForgeError(error) && error.status === 400) return { kind: 'invalid' };
      throw error;
    }
  }

  private async toView(record: Record<string, unknown>, editor: Editor | null): Promise<PostView> {
    const authorId = typeof record['author'] === 'string' ? record['author'] : null;
    return {
      id: String(record['id']),
      slug: String(record['slug'] ?? ''),
      title: String(record['title'] ?? ''),
      summary: String(record['summary'] ?? ''),
      paragraphs: toParagraphs(record['body']),
      status: record['_status'] === 'published' ? 'published' : 'draft',
      byline: await this.byline(authorId),
      updatedAt: String(record['updatedAt'] ?? ''),
      canChangeStatus:
        editor !== null &&
        (editor.role === 'admin' || (editor.role === 'editor' && authorId === editor.id))
    };
  }

  /**
   * Bylines are public by editorial decision: trusted server code reads the author's display name only.
   * The users collection itself stays private (emails, roles and session data never leave this method).
   */
  private async byline(authorId: unknown): Promise<string> {
    if (typeof authorId !== 'string' || !ID.test(authorId)) return 'Staff writer';
    try {
      const author = (await this.runtime.findByID({ collection: 'users', id: authorId })) as Record<
        string,
        unknown
      >;
      const name = author['name'];
      return typeof name === 'string' && name.trim() !== '' ? name : 'Staff writer';
    } catch {
      return 'Staff writer';
    }
  }
}

function toEditor(user: CmsUser): Editor {
  return { id: user.id, role: user.role ?? 'viewer', name: user.name ?? 'Editor' };
}

function toCmsUser(editor: Editor | null): CmsUser | null {
  return editor ? { id: editor.id, role: editor.role, name: editor.name } : null;
}

/** Rich text → plain paragraphs. Rendering is text-only: no HTML from the database reaches the page. */
function toParagraphs(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const text = (node: RichTextNode): string =>
    typeof node.text === 'string' ? node.text : (node.children ?? []).map(text).join('');
  return (body as RichTextNode[]).map(text).filter((paragraph) => paragraph.trim() !== '');
}
