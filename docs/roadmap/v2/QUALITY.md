# V2 cross-cutting quality requirements

Every milestone carries the following requirements where applicable. Evidence must identify the exact commit, package artifacts, adapter/profile, and command or procedure used.

## Release and compatibility

- Keep the stable 1.x public surface and SemVer policy intact. Product milestones do not map one-to-one to npm versions.
- Verify changes against public packed artifacts and external-consumer entry points when they affect published packages.
- Document upgrade and migration implications. V2.0 requires an intentional compatibility decision and a rehearsed 1.x-to-2.0 path.
- Release authorization, protected-branch checks, artifact provenance, and registry verification must be explicit and auditable.

## Security and privacy

- Threat-model authentication, authorization, secret handling, diagnostics, uploads, and destructive actions.
- Apply authorization in the server/runtime boundary; redact credentials and sensitive provider errors from logs and responses.
- Bound expensive work and request input. Production diagnostics must be scoped and safe by default.
- Record security findings and show that critical/high findings are fixed or have an explicit accepted disposition before release.

## Usability and accessibility

- Validate complete user journeys, not only rendered controls. Empty, loading, error, permission-denied, and recovery states must be useful.
- Support keyboard operation, visible focus, semantic status text, screen-reader labels, reduced motion, and responsive layouts.
- Avoid decorative fake metrics, inert controls, dead links, and false progress indicators.

## CI, adapters, and consumers

- Keep strict TypeScript and Angular template checks, unit/regression coverage, and applicable contract suites.
- Run supported behavior against every adapter that claims it; unsupported capabilities must fail clearly rather than silently diverge.
- Build clean consumer projects from published tarballs for the documented setup paths and supported framework/profile combinations.
- Keep `pnpm docs:verify` and public site checks aligned with canonical roadmap data.

## Performance and deployment

- Measure representative operations and bundle/interaction costs; state Worker and Node boundaries from evidence.
- Rehearse production builds, restart persistence, upgrades, backups, restore, and storage reconciliation for supported profiles.
- Do not infer universal provider or traffic guarantees from a single certified environment.

## Evidence and completion

- Each milestone links test runs, certification results, user validation, and known limitations in its outcome record.
- Acceptance criteria must be observable and repeatable. Targets such as onboarding time are measured before being reported as achieved.
- A roadmap status change requires matching evidence and an update to the canonical inventory, internal milestone record, and public page in one reviewed change.
