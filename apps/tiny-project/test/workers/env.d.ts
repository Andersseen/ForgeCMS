// Ambient declaration for the real-Workers-runtime D1 lifecycle proof (spec 055). Mirrors
// packages/cloudflare/test/workers/env.d.ts's convention — a fixed, small, test-only binding set.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
    }
  }
}

export {};
