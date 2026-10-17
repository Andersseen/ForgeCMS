# @forge-cms/agent

## 1.0.0

### Minor Changes

- 2e004ee: `forge-cms-agent init|sync|check` (spec 096): one command connects a coding agent - it merges the MCP entry into `.mcp.json`, copies the eight skills to `.claude/skills/` (`--target agents` for `.agents/skills/`) and
  prints the Codex snippet, replacing the manual copy steps. Idempotent, `--dry-run`, package manager picked from the lockfile, writes only inside the project (never through a symlink), never overwrites a differing entry
  or a skill folder it did not create without `--force`; `check` writes nothing and exits 1 when anything is missing or stale. New programmatic exports `installAgentKit` and `checkAgentKit`. Still experimental and
  outside the stable 1.x compatibility promise.
- 43b2d19: New **experimental** package `@forge-cms/agent` (spec 093): development-time tooling for AI coding agents. A read-only local MCP server (`pnpm exec forge-cms-mcp`) that detects how a project uses ForgeCMS, runs a few
  Forge-specific checks, searches the version-matched documentation bundled in the package, reports support facts and reads a running app's anonymous public metadata, plus an official skill pack (setup, content modelling,
  admin, localization, auth and access, Cloudflare, Analytics, migrations and recovery). It is outside the stable 1.x compatibility promise, is never a runtime dependency, and collects no telemetry. The stable packages are
  unchanged. Cloudflare Analytics stays experimental; its onboarding recipe is now documented and verified.

## 1.0.0-rc.2

### Minor Changes

- e2d2fd8: `forge-cms-agent init|sync|check` (spec 096): one command connects a coding agent - it merges the MCP entry into `.mcp.json`, copies the eight skills to `.claude/skills/` (`--target agents` for `.agents/skills/`) and
  prints the Codex snippet, replacing the manual copy steps. Idempotent, `--dry-run`, package manager picked from the lockfile, writes only inside the project (never through a symlink), never overwrites a differing entry
  or a skill folder it did not create without `--force`; `check` writes nothing and exits 1 when anything is missing or stale. New programmatic exports `installAgentKit` and `checkAgentKit`. Still experimental and
  outside the stable 1.x compatibility promise.

## 1.0.0-rc.1

### Minor Changes

- 43b2d19: New **experimental** package `@forge-cms/agent` (spec 093): development-time tooling for AI coding agents. A read-only local MCP server (`pnpm exec forge-cms-mcp`) that detects how a project uses ForgeCMS, runs a few
  Forge-specific checks, searches the version-matched documentation bundled in the package, reports support facts and reads a running app's anonymous public metadata, plus an official skill pack (setup, content modelling,
  admin, localization, auth and access, Cloudflare, Analytics, migrations and recovery). It is outside the stable 1.x compatibility promise, is never a runtime dependency, and collects no telemetry. The stable packages are
  unchanged. Cloudflare Analytics stays experimental; its onboarding recipe is now documented and verified.
