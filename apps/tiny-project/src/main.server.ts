// SSR entry point stub — required by @analogjs/platform build. SSR is disabled (this app is
// `ssr: false`, same as apps/www and apps/demo-aesthetics); this file is never actually used.
export default function bootstrap() {
  return Promise.resolve();
}
