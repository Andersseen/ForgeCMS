# Security policy

## Supported versions

ForgeCMS is published as eleven `@forge-cms/*` packages that always share one version. Security fixes are made against, and released as a patch of, the
**latest published version line** (currently `0.13.x`). Once 1.0 is released the policy is: the latest `1.x` receives security fixes; see
[docs/SUPPORT.md](docs/SUPPORT.md) for the semver and deprecation rules. Older lines are not patched — upgrade to the latest patch.

## Reporting a vulnerability

**Please do not publish exploit details in a public issue, pull request or discussion.**

GitHub's _private vulnerability reporting_ is **not enabled** on this repository at the time of writing, and no security email address is published. Until that
changes, the only mechanism that exists is:

1. Open a GitHub issue in [Andersseen/ForgeCMS](https://github.com/Andersseen/ForgeCMS/issues) titled **"Security report — please contact me"**. State only that
   you have a suspected vulnerability and which package it concerns. Include **no** technical detail, proof of concept, credentials or affected-deployment names.
2. The maintainer will reply on the issue to arrange a private channel for the details. Report the problem there, not in the public thread.

This file will be updated when a private reporting channel is enabled; do not assume one exists before it says so.

### What to expect

ForgeCMS is maintained by an individual maintainer. There is **no response-time commitment or SLA**. A report is acknowledged and assessed on a best-effort basis,
a confirmed vulnerability is fixed in a patch release of the affected packages, and the fix is described in the package changelogs once it is released. Please
allow time for a fix before any public disclosure.

## Not a security report

Ordinary bugs, questions and feature requests belong in [GitHub issues](https://github.com/Andersseen/ForgeCMS/issues). If you are unsure whether something is security
relevant, use the private path above rather than a public issue.

## Security properties worth knowing

The auth, access-control, CSRF, upload-ownership and secret-handling guarantees are documented in the
[browser auth](apps/www/src/content/docs/browser-auth.md), [machine auth](apps/www/src/content/docs/machine-auth.md),
[access control](apps/www/src/content/docs/access-control.md) and [uploads](apps/www/src/content/docs/uploads.md) guides, and the evidence for them is in the
[release dossier](docs/1.0-RELEASE-DOSSIER.md#g-security). Known design bounds (for example stateless-token logout and the password-hash cost) are listed there
and in [docs/LIMITATIONS.md](docs/LIMITATIONS.md); they are documented limits, not undisclosed issues.
