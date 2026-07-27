/**
 * The localStorage key `@forge-cms/admin`'s layout reads to decide whether someone is logged in.
 * It is not exported by the package, so every consuming app has to hardcode the same string
 * (finding 12 in docs/DEMO-FINDINGS.md).
 */
export const AUTH_TOKEN_KEY = 'forge-auth-token';
