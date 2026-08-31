// Ambient declarations for the real-Workers-runtime integration suite (spec 051). Cloudflare's own
// `@cloudflare/workers-types` declares `Cloudflare.Env`/`Cloudflare.GlobalProps` as empty interfaces
// meant to be merged with project-specific ones (normally produced by `wrangler types`); hand-written
// here since this is a fixed, small, test-only binding set — see `wrangler.test.jsonc`.
import type * as mainWorker from './fixtures/worker.js';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BUCKET: R2Bucket;
    }

    interface GlobalProps {
      // Declares the `main` worker's exports so `exports.default` (from `cloudflare:workers`) is
      // typed — used only by `http-integration.test.ts`'s `exports.default.fetch(...)` calls.
      mainModule: typeof mainWorker;
    }
  }
}

export {};
