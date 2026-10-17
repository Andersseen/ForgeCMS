// A server-only ForgeCMS consumer: libSQL file database, the framework-agnostic HTTP handlers mounted on
// node:http. No Angular, no admin UI, no browser dependency. Compiled with tsc and run as plain Node.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiContext } from '@forge-cms/api';
import { buildSessionCookie } from '@forge-cms/auth';
import {
  handleCreate,
  handleDelete,
  handleGlobalRead,
  handleGlobalUpdate,
  handleList,
  handleLogin,
  handleLogout,
  handleMe,
  handleRead,
  handleUpdate
} from '@forge-cms/runtime';
import { createRuntime, type Env } from './runtime.js';

const { runtime, auth, env } = await createRuntime();

const cookie = { secure: false }; // plain http on 127.0.0.1
const writers: Array<'admin' | 'editor'> = ['admin', 'editor'];

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method,
    headers,
    ...(method !== 'GET' && method !== 'HEAD' && body.length > 0 && { body })
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    headers[key] = key === 'set-cookie' ? response.headers.getSetCookie() : value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra }
  });
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const ctx = (params: Record<string, string> = {}): ApiContext<Env> => ({ request, params, env });
  const method = request.method;

  if (url.pathname === '/api/bootstrap-admin' && method === 'POST') {
    if ((await auth.listUsers()).length > 0) {
      return json(409, { error: { code: 'CONFLICT', message: 'Already initialized' } });
    }
    const input = (await request.json()) as { email: string; password: string };
    const admin = await auth.createUser(input);
    if (!admin.ok) return json(400, { error: { code: 'INVALID_INPUT', message: admin.reason } });
    // A second, least-privileged account so the access-control checks have a real "viewer".
    await auth.createUser({
      email: 'viewer@example.test',
      password: input.password,
      role: 'viewer'
    });
    const login = await auth.login(input.email, input.password);
    const setCookie = login.ok ? { 'set-cookie': buildSessionCookie(login.token, cookie) } : {};
    return json(201, { data: { user: admin.user } }, setCookie);
  }
  if (url.pathname === '/api/auth/login' && method === 'POST')
    return handleLogin(ctx(), { runtime, cookie });
  if (url.pathname === '/api/auth/logout' && method === 'POST')
    return handleLogout(ctx(), { runtime, cookie });
  if (url.pathname === '/api/auth/me' && method === 'GET') return handleMe(ctx(), { runtime });

  if (parts[0] === 'api' && parts[1] === 'v1') {
    if (parts[2] === 'globals' && parts[3] !== undefined) {
      const context = ctx({ global: parts[3] });
      if (method === 'GET') return handleGlobalRead(context, { runtime });
      if (method === 'PUT') return handleGlobalUpdate(context, { runtime });
    } else if (parts[2] !== undefined) {
      const collection = parts[2];
      const id = parts[3];
      if (id === undefined) {
        if (method === 'GET') return handleList(ctx({ collection }), { runtime });
        if (method === 'POST')
          return handleCreate(ctx({ collection }), { runtime, allowedRoles: writers });
      } else {
        const context = ctx({ collection, id });
        if (method === 'GET') return handleRead(context, { runtime });
        if (method === 'PUT') return handleUpdate(context, { runtime, allowedRoles: writers });
        if (method === 'DELETE') return handleDelete(context, { runtime, allowedRoles: ['admin'] });
      }
    }
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'No such route' } });
}

const server = createServer((req, res) => {
  toRequest(req)
    .then(route)
    .then((response) => send(res, response))
    .catch((error: unknown) => {
      console.error('unhandled', error);
      res.writeHead(500).end();
    });
});
server.listen(Number(process.env['PORT'] ?? 0), '127.0.0.1', () => {
  const address = server.address();
  console.log(`listening ${typeof address === 'object' && address ? address.port : ''}`);
});
