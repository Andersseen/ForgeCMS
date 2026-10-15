# 096 — Agent Kit one-command install (`forge-cms-agent init`)

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-10-15
- **Branch:** `feature/spec-096-agent-init-cli` (stacked on spec 095 / PR #101)
- **Affected packages/apps:** `@forge-cms/agent`, `apps/www` (docs page), scripts and coverage floors

## Context / Why

Spec 093 shipped the Agent Kit with a manual install: hand-paste an MCP JSON/TOML and `cp -R` the skills, repeated after every upgrade, with nothing telling you the skills are stale. That is poor DX for the
first-run path of the package, found while preparing the first public RC (nothing is published yet, so the candidate can still change at low cost). `1.0.0-rc.1` is therefore superseded by `rc.2`.

## Goal

`pnpm exec forge-cms-agent init` connects a coding agent to the project in one idempotent, safe step; `check` reports drift; the web docs lead with it.

## Non-goals

No new MCP tool, no write capability on the MCP server, no network access, no writing outside the project (Codex's `~/.codex/config.toml` is printed, never written), no Agentyx manifest, no stable-API promise
(the package stays experimental).

## Design

- Bin `forge-cms-agent` (`init`, `sync` alias, `check`); `forge-cms-mcp` unchanged. Options: `--root`, `--target claude|agents|claude,agents` (default `claude`), `--package-manager`, `--dry-run`, `--force`.
- `init`: merges `mcpServers["forge-cms"]` into `.mcp.json` (other keys/servers kept; the entry uses the project's package manager from its lockfile) and copies each bundled skill to `<target>/<name>/` with a
  `.forge-cms-agent.json` stamp `{version}`. Per action: `create | update | unchanged | conflict`. A second run is all `unchanged`.
- Safety: a differing `forge-cms` entry, a skill folder without our stamp, an invalid/non-object `.mcp.json`, a non-directory in the way, or any symlinked path component is a `conflict` that is reported and left
  untouched (exit 1) unless `--force` (never forces through a symlink or invalid JSON). `check` writes nothing and exits 1 unless everything is `unchanged`. No credential is read.
- Programmatic: `installAgentKit(options)`, `checkAgentKit(options)` and their types (experimental surface, baseline updated).

## Implementation plan

- [x] `install.ts`, `cli.ts`, `init-bin.ts`, `package.json` bin, `index.ts` exports
- [x] unit tests (install, cli) and `runtime-metadata` tests; `agent` added to the coverage floors (`non-ui`)
- [x] packed-consumer certification (`scripts/verify-agent-kit.mjs`): init → check → MCP started from the written config → drift → sync; `agent-boundary` test
- [x] docs: package README, `/docs/agent-kit`, REFERENCE, PUBLIC-SURFACE; www e2e for the page
- [x] extra unit coverage: `defineUsersCollection` access, `provideForgeAnalytics`, credential registry, linker transform
- [x] changeset, api-baseline, STATE, dossier

## Test plan

Unit (`install.test.ts`, `cli.test.ts`, `runtime-metadata.test.ts` + the extra angular/auth tests), Playwright (`docs.spec.ts` Agent Kit page), packed consumer (`pnpm release:certify`, stage `agent`),
`pnpm test:coverage` (agent now gated).

## Acceptance criteria

1. `init` creates, a second `init` is a no-op, `check` is 1 → 0 → 1 across init/drift/sync, on the packed tarball.
2. Existing user config and skills are never overwritten without `--force`; nothing is written through a symlink or outside the project; `.env` untouched; no secret in `.mcp.json`.
3. The MCP server starts from the `.mcp.json` that `init` wrote.
4. `agent` meets the `non-ui` coverage floor; docs gates and the standard gates green.

## Open questions

None.

## Outcome

Shipped as `forge-cms-agent`; candidate bumped to `1.0.0-rc.2` (rc.1 was never published).
