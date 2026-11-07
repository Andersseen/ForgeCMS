// Executable minimal reproductions of the Strata findings recorded in ADOPTION-REPORT.md. They pin the
// CURRENT published behaviour: when Strata changes it, the assertion flips and the finding is re-checked.
// Nothing here patches Strata.
import { Controller, Get } from '@strata-sc/core';
import { registerControllers } from '@strata-sc/analog';
import type { NitroRouter, StrataAnalogRequest } from '@strata-sc/analog';
import { describe, expect, it } from 'vitest';

describe('S-1: StrataAnalogRequest.url origin on a Node (node-server) H3 event', () => {
  it('is a placeholder http://localhost, not the Host the request reached', async () => {
    let seen: URL | undefined;

    @Controller('/api/probe')
    class ProbeController {
      @Get('/')
      read(request: StrataAnalogRequest) {
        seen = request.url;
        return { ok: true };
      }
    }

    const handlers: ((event: never) => unknown)[] = [];
    const router: NitroRouter = {
      add: (_path, handler) => {
        handlers.push(handler as never);
        return undefined;
      }
    };
    registerControllers(router, [ProbeController]);

    // The shape H3 1.15 hands a node-server route: no `web`, a Node request with a Host header.
    const event = {
      method: 'GET',
      path: '/api/probe/',
      headers: new Headers({ host: 'editorial.example:8443', 'x-forwarded-proto': 'https' }),
      context: {},
      node: {
        req: { method: 'GET', url: '/api/probe/', headers: { host: 'editorial.example:8443' } }
      }
    };
    await handlers[0]?.(event as never);

    expect(seen?.pathname).toBe('/api/probe/');
    // Finding: the origin ignores the Host header; an origin check against `request.url` refuses every
    // legitimate same-origin request (fails closed). The consumer rebuilds the origin (originRequest()).
    expect(seen?.origin).toBe('http://localhost');
  });
});
