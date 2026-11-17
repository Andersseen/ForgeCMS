---
'@forge-cms/admin': minor
'@forge-cms/auth': minor
---

ForgeCMS 1.1.0 — roadmap V2-01 (Foundation, Security & Release Governance) and Angular 22 for the admin.

**Admin on Angular 22 (spec 103).** The `@angular/{cdk,common,compiler-cli,core,forms,platform-browser,router}` peers widen from `^21.2.0` to `^21.2.0 || ^22.0.0`, the optional `@babel/core` peer to `^7.28.0 || ^8.0.0` (Angular 22.1+ links with Babel 8), and `lumen-icons` to `^0.2.0 || ^0.3.0`. Angular 21 consumers are unaffected; `@voltui/components` stays `^1.0.1` (install 1.3.2+ on Angular 22).

**Admin accessibility (spec 104).** A "Skip to main content" link, a labelled `Admin` navigation landmark, a breadcrumb `nav` list with `aria-current="page"`, and a `main` landmark around the routed page and the sign-in/sign-up pages (dropped when the host already provides a `main` landmark). Focus moves to the main region when a navigation would strand it on `<body>`. "Log in", "Exit" and each sidebar entry are a single Tab stop. No API or configuration change.

**Password work factor and rehash-on-login (spec 105).** `UsersCollectionAuthAdapter` gains `passwordHashing: { iterations }` (PBKDF2-HMAC-SHA256; default 100 000, unchanged) and the presets `PASSWORD_HASHING_PRESETS.workers` (100 000, sized for the Cloudflare Workers Free plan's 10 ms CPU) and `.node` (600 000). A raised work factor writes versioned hashes (`$pbkdf2-sha256$i=…`); every older hash, including 1.0's, keeps verifying and is upgraded on the user's next successful login (compare-and-set, sessions kept). At the default nothing stored changes, so a rollback to 1.0 keeps working.
