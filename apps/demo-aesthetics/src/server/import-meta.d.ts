/**
 * Nitro's build-time flag: its bundler replaces `import.meta.dev` with a literal — `true` under the
 * Analog dev server, `false` in every production build. Undefined anywhere Nitro did not bundle the
 * code (unit tests), which therefore counts as "not development".
 */
interface ImportMeta {
  readonly dev?: boolean;
}
