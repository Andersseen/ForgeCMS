# 093 — Experimental Forge Agent Kit and client-ready Analytics onboarding

- **Status:** in-progress
- **Author:** agent draft (maintainer-approved pre-L02 scope amendment)
- **Date:** 2026-10-14
- **Branch:** `release/spec-092-forgecms-1.0-rc` (inserted into the open L01 candidate PR before any RC was published)
- **Affected packages/apps:** new `@forge-cms/agent`; release tooling (`scripts/*`, `release:certify`); `apps/demo-aesthetics` (tested Analytics recipe + client-site scenario); `@forge-cms/admin` (tests only); documentation; website docs

## Context / Why

The maintainer deliberately widened the 1.0 release line, before real-consumer observation (L02), with two developer/client-facing capabilities: an **experimental** official MCP server + skill pack for coding agents,
and the already-existing **experimental** Forge Analytics vertical with a complete, copyable, verified onboarding recipe. This is an explicit scope amendment, **not** a defect-only L02 change. It does not touch the
stable surface frozen in U03.

State when the amendment was applied (state A of the instruction): the L01 candidate `1.0.0-rc.0` was prepared and certified locally (commit `f25ae13`) and **never published**; PR #99 was open. That `rc.0` is therefore
**historical, superseded evidence**: its hashes certify neither the new package nor the changed tooling. The candidate observed by L02 is the new one produced by this spec.

## Goal

A developer can add ForgeCMS to a new project, connect an official read-only ForgeCMS MCP server and install an official ForgeCMS skill pack so a fresh coding-agent session can discover the project's ForgeCMS setup,
consult version-matched Forge documentation and follow the supported setup patterns. The same agent can enable the existing experimental Cloudflare Analytics vertical from one verified recipe. These capabilities ship
experimentally without changing the stable ForgeCMS 1.0 CMS API contract.

## Non-goals

No visual page builder; no content-generation AI; no agent that writes production content; no autonomous deployment; no arbitrary shell execution; no arbitrary file reading tool; no database credential access; no production
D1/R2 mutation; no MCP write/mutation tools; no general Forge CLI; no hosted/remote MCP service; no stable Analytics promotion; no visitor identifiers or cookies; no Strata changes; no new localization capability; no
telemetry from the kit.

## Design

### One package: `@forge-cms/agent`

Experimental, public, ESM-only, Node >= 22, **dev-time only**. It owns the stdio MCP server (`forge-cms-mcp`), the skill-pack sources (`skills/`) and a version-matched documentation corpus (`docs/`, generated at build by
`scripts/build-agent-docs.mjs` from a curated list - historical specs are never included). It joins the Changesets **fixed family**, which therefore has **twelve** packages; every hardcoded "eleven" in the release
tooling, certification packer, verifiers, release helpers and documentation was updated (`PUBLIC_FAMILY`, `PUBLIC_PACKAGES`, `verify-release`, `verify-public-consumers`, `.changeset/config.json`, tests).

Dependency direction: `@forge-cms/agent` -> nothing in Forge (it has no runtime dependency on any other Forge package and does not import application code). No stable package, app or browser bundle depends on it
(`scripts/agent-boundary.test.mjs`, the browser-bundle scans now also forbid `@modelcontextprotocol` and `forge-cms-mcp`). SDK: `@modelcontextprotocol/sdk` 1.32.1 (official, maintained, Node >= 18), with `zod`.

The package is labelled experimental in its manifest, README, the guide, REFERENCE, MATRICES, SUPPORT, LIMITATIONS and 1.0-PUBLIC-SURFACE; `pnpm docs:verify` enforces it. It has its own API baseline
(`api-baseline/_forge-cms_agent.json`); no stable baseline changed.

### MCP (local stdio, read-only)

Tools (none takes a path; all annotated read-only): `forge_project_detect`, `forge_project_doctor`, `forge_docs_search`, `forge_support`, `forge_runtime_metadata`.
Resources: `forge://docs/<guide>`, `forge://skills/<skill>`, `forge://support`, `forge://project`.

- **Detection** reads only a fixed allowlist of conventional files through `ProjectReader` (relative paths only, no `..`, regular files, 256 KB per file and 2 MB per inspection, real path must stay inside the project root,
  no symlink escape, bounded depth/count, `node_modules`/`dist`/`.git` skipped). It returns package versions, framework versions, Wrangler **binding names** and variable **names** (never values), admin mount,
  localization and analytics wiring. Project-controlled strings are stripped of control characters and capped.
- **Doctor** has ~12 high-confidence checks (`pass|warning|error|unknown`): fixed-family versions, admin on Angular 21, admin peers, official Vite linker, `withComponentInputBinding()`, server-only imports in browser
  code, deep imports, D1/R2 bindings, secrets in `[vars]`, in-memory runtime, Analytics binding/summary route, deprecated admin options, the kit as a production dependency. It does not duplicate the compiler or linter.
- **Docs search** is offline keyword search over the bundled corpus and skills, returning title, heading, excerpt, id and the version the docs correspond to.
- **Support** facts come from one definition (`support.ts`) mirroring `docs/SUPPORT.md`.
- **Runtime metadata** is included because the anonymous `GET /api/v1/collections` endpoint already exists: GET only, explicit origin, http(s) only, no credentials in the URL, no cookies/tokens, `redirect: 'error'`, 5 s timeout,
  512 KB cap, no private field (the endpoint already omits unreadable fields). No new introspection endpoint was invented and no application module is ever imported.
- No telemetry; the only network request is an explicit `forge_runtime_metadata` call.

### Skills (tool-neutral source of truth)

Eight skills: `forgecms-setup`, `-content-modeling`, `-admin`, `-localization`, `-auth-access`, `-cloudflare`, `-analytics`, `-migrations-recovery`. They use only public specifiers, describe the current version, and state
limits and "do not" rules (for example never `overrideAccess: true` in a user-facing flow; localization only for top-level `text`/`textarea`). Golden-task tests (`skills.test.ts`) check the eight common agent tasks against
the skill sources. **Agentyx:** the installed Agentyx (0.11.0) exposes only built-in trusted skill sources and no supported mechanism for third-party packs, so no Agentyx manifest was invented; the canonical `SKILL.md`
files ship in the package, and the guide documents copying them to `.claude/skills` / `.agents/skills`. An Agentyx adapter remains a future integration.

### Analytics onboarding (still experimental)

The collector and summary logic were extracted from the demo's route files into pure, tested modules (`apps/demo-aesthetics/src/server/analytics/{collect,summary}.ts`); the routes are thin wrappers. The website guide
`analytics.md` embeds those exact files (`<!-- snippet: -->`, checked by `docs:verify`), so the recipe cannot drift from tested code. Tests prove: only sanitized pathname/referrer host/country/site id are recorded (query,
hash, IP, email, user id, visitor id and arbitrary body fields never are); missing `ANALYTICS` binding no-ops; invalid range -> 400; missing credentials -> `configured: false` without building a client; a failed query ->
empty configured summary. The admin dashboard gained behavioural tests (range, loading, error/retry, change sign, timeline bars, top pages/referrers/countries). No Analytics export was added or promoted; no coverage floor
changed; no visitor identifier exists.

### Client-site scenario

`apps/demo-aesthetics/src/scenarios/client-site-collections.ts` (siteSettings global, pages, services, posts, media; ES/EN; shared images and slugs) is embedded in the Agent Kit guide and run against the real runtime
(`client-site-scenario.test.ts`), including the refusals for unsupported localized shapes.

### Packed external consumer

`scripts/verify-agent-kit.mjs` is a new `release:certify` stage `agent`: from the exact packed tarballs, in a clean project, it installs the kit, launches `pnpm exec forge-cms-mcp` over real stdio, handshakes, lists
tools/resources, calls detect/doctor/support/docs search, checks the bin and the eight skills, forbids source/test/`.env`/agent-config files in the tarball, and proves no secret or foreign file leaks.

## Implementation plan

- [x] `packages/agent` (reader, detect, doctor, docs, support, runtime metadata, server, bin), skills, docs corpus builder
- [x] Unit/adversarial tests (reader traversal/symlink/size, detect, doctor, docs, server protocol and security, skills golden tasks)
- [x] Analytics: extract tested modules, privacy/behaviour tests, dashboard tests, guide
- [x] Client-site scenario + Agent Kit guide + package README
- [x] Twelve-package release tooling + `agent` certify stage + browser-bundle regression
- [x] `docs:verify` agent-kit checks; docs inventory updated
- [ ] Changeset, next RC through Changesets pre mode, CI changeset-check for pre mode
- [ ] Full matrix on the exact new candidate; dossier/STATE/roadmap

## Test plan

`pnpm --filter @forge-cms/agent test`; `node --test scripts/*.test.mjs`; demo `analytics-recipe` and `client-site-scenario` tests; admin dashboard tests; `pnpm docs:verify`; `pnpm release:certify` (stage `agent`); the full
RC matrix of spec 092 on the new candidate.

## Acceptance criteria

The 66 criteria of the spec 093 instruction (see Outcome for the evidence of each group).

## Open questions

None.

## Outcome

_Filled in as evidence is produced._
