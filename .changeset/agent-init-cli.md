---
'@forge-cms/agent': minor
---

`forge-cms-agent init|sync|check` (spec 096): one command connects a coding agent - it merges the MCP entry into `.mcp.json`, copies the eight skills to `.claude/skills/` (`--target agents` for `.agents/skills/`) and
prints the Codex snippet, replacing the manual copy steps. Idempotent, `--dry-run`, package manager picked from the lockfile, writes only inside the project (never through a symlink), never overwrites a differing entry
or a skill folder it did not create without `--force`; `check` writes nothing and exits 1 when anything is missing or stale. New programmatic exports `installAgentKit` and `checkAgentKit`. Still experimental and
outside the stable 1.x compatibility promise.
