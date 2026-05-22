import { defineEventHandler, getRequestURL } from 'h3';
import { serverRuntime } from '../api/runtime';

/**
 * Middleware de auth opcional.
 *
 * Inyecta `forgeUser` en el contexto del evento si hay un token válido.
 * No bloquea la request — las rutas deciden si requieren auth o no.
 */
export default defineEventHandler(async (event) => {
  const authHeader = event.node.req.headers.authorization;
  if (!authHeader) return;

  const request = new Request(getRequestURL(event).toString(), {
    headers: event.node.req.headers as Record<string, string>
  });

  try {
    const user = await serverRuntime.adapters.auth.validateSession(
      authHeader.replace('Bearer ', '')
    );
    if (user) {
      event.context.forgeUser = user.user;
    }
  } catch {
    // Token inválido, seguimos sin usuario
  }
});
