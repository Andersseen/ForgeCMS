// SSR entry point stub — required by @analogjs/platform's build even with `ssr: false`.
// See finding 2 in docs/DEMO-FINDINGS.md: a marketing site really wants SSR, but the app runs as an
// SPA for the same reasons apps/www does.
export default function bootstrap() {
  return Promise.resolve();
}
