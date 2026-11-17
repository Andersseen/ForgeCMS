---
'@forge-cms/admin': minor
---

ForgeCMS 1.1.0 — roadmap V2-01 (Foundation, Security & Release Governance) and Angular 22 for the admin.

**Admin on Angular 22 (spec 103).** The `@angular/{cdk,common,compiler-cli,core,forms,platform-browser,router}` peers widen from `^21.2.0` to `^21.2.0 || ^22.0.0`, the optional `@babel/core` peer to `^7.28.0 || ^8.0.0` (Angular 22.1+ links with Babel 8), and `lumen-icons` to `^0.2.0 || ^0.3.0`. Angular 21 consumers are unaffected; `@voltui/components` stays `^1.0.1` (install 1.3.2+ on Angular 22).

**Admin accessibility (spec 104).** A "Skip to main content" link, a labelled `Admin` navigation landmark, a breadcrumb `nav` list with `aria-current="page"`, and a `main` landmark around the routed page and the sign-in/sign-up pages (dropped when the host already provides a `main` landmark). Focus moves to the main region when a navigation would strand it on `<body>`. "Log in", "Exit" and each sidebar entry are a single Tab stop. No API or configuration change.
