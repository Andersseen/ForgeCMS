# @forge-cms/agent

## 1.0.0-rc.1

### Minor Changes

- 43b2d19: New **experimental** package `@forge-cms/agent` (spec 093): development-time tooling for AI coding agents. A read-only local MCP server (`pnpm exec forge-cms-mcp`) that detects how a project uses ForgeCMS, runs a few
  Forge-specific checks, searches the version-matched documentation bundled in the package, reports support facts and reads a running app's anonymous public metadata, plus an official skill pack (setup, content modelling,
  admin, localization, auth and access, Cloudflare, Analytics, migrations and recovery). It is outside the stable 1.x compatibility promise, is never a runtime dependency, and collects no telemetry. The stable packages are
  unchanged. Cloudflare Analytics stays experimental; its onboarding recipe is now documented and verified.
