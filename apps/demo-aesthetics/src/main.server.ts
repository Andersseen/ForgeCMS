// SSR entry point stub — required by @analogjs/platform's build even with `ssr: false`.
// ForgeCMS itself supports and certifies Angular/Analog SSR (docs/DEMO-FINDINGS.md, finding 2), but
// Lumea deliberately keeps its existing SPA rendering mode: moving a deployed site to SSR changes
// runtime behaviour and belongs in consumer observation, not in a presentation change.
export default function bootstrap() {
  return Promise.resolve();
}
