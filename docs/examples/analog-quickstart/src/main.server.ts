// Analog's build requires a server entry even with `ssr: false`. This app renders in the browser;
// the SSR guide replaces this stub with a real renderer.
export default function bootstrap() {
  return Promise.resolve();
}
