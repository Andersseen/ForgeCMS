// Placeholder `main` module — @cloudflare/vitest-plugin requires one to boot Miniflare/workerd and
// provision the bindings declared in ../../../wrangler.test.jsonc, even though this fixture's own
// tests talk to the D1 binding directly (via `env` from `cloudflare:workers`), not through HTTP.
export default {
  async fetch(): Promise<Response> {
    return new Response('forge-cms-tiny-project test worker', { status: 200 });
  }
};
