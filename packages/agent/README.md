# @forge-cms/agent

> **EXPERIMENTAL development tooling.** Versioned with the other ForgeCMS packages, but its MCP tools, resources and skills may change in a compatible 1.x minor and are **outside the stable 1.x public-surface guarantee**.
> Never a runtime dependency of an application. It collects no telemetry.

A read-only, **local** Model Context Protocol server and an official skill pack so an AI coding agent (Claude Code, Codex, ...) can discover how your project uses ForgeCMS and follow the supported patterns - with documentation
**matched to the exact version you installed** (nothing is fetched from the internet).

## Install

```bash
pnpm add -D @forge-cms/agent
```

Node >= 22. Development dependency only: do not import it from application or browser code.

## Connect your agent (one command)

```bash
pnpm exec forge-cms-agent init
```

It writes the MCP entry to `.mcp.json` (merging with what is there) and copies the eight skills to `.claude/skills/`. Use `--target agents` (or `--target claude,agents`) for agents that read `.agents/skills/`, and
`--dry-run` to see the plan first. It is idempotent, picks `pnpm`/`npm`/`yarn`/`bun` from your lockfile, and writes only inside the project, never through a symlink.

| Command                 | Purpose                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `forge-cms-agent init`  | Connect the agent. Re-run (or `sync`) after upgrading ForgeCMS so the skills match the new version.   |
| `forge-cms-agent check` | Writes nothing; exits 1 if the entry or a skill is missing or stale (usable in CI).                   |
| `--force`               | Replace a differing `forge-cms` entry or a skill folder you created yourself (never done by default). |

Codex reads `~/.codex/config.toml`, outside your project, so `init` prints the snippet instead of writing it:

```toml
[mcp_servers.forge-cms]
command = "pnpm"
args = ["exec", "forge-cms-mcp"]
```

The MCP server itself is `pnpm exec forge-cms-mcp` (optionally `--root <project dir>`). No token, password, `AUTH_SECRET` or Cloudflare credential is needed or accepted.

## Tools (all read-only, none takes a path)

| Tool                     | Purpose                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `forge_project_detect`   | Forge package versions, Angular/Analog/Vite, profile, admin mount, localization, analytics wiring |
| `forge_project_doctor`   | A few Forge-specific static checks: `pass` / `warning` / `error` / `unknown`                      |
| `forge_docs_search`      | Search the documentation and skills bundled with this version                                     |
| `forge_support`          | Supported and tested versions and experimental status                                             |
| `forge_runtime_metadata` | Anonymous, sanitized `/api/v1/collections` metadata of a running app (http/https, GET only)       |

Resources: `forge://docs/<guide>`, `forge://skills/<skill>`, `forge://support`, `forge://project`.

## Skills

The package ships `skills/<name>/SKILL.md` for: `forgecms-setup`, `forgecms-content-modeling`, `forgecms-admin`, `forgecms-localization`, `forgecms-auth-access`, `forgecms-cloudflare`, `forgecms-analytics`,
`forgecms-migrations-recovery`. `forge-cms-agent init` installs them (each folder carries a small `.forge-cms-agent.json` stamp with the version, which is how `sync` knows the folder is its own).

## Security boundary

One project directory, fixed at start-up, read through a bounded reader (a fixed list of conventional files, size caps, no symlink out of the project). It never returns file contents or secret values - only names, versions and
findings - and has no tool that writes, executes, deploys, migrates or reads an arbitrary path.

Full guide: [Agent Kit](https://github.com/Andersseen/ForgeCMS/blob/main/apps/www/src/content/docs/agent-kit.md).
