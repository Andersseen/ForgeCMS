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

## Connect the MCP server

The command is always `pnpm exec forge-cms-mcp` (optionally `--root <project dir>`; the default is the current directory). Example `.mcp.json` for Claude Code:

```json
{ "mcpServers": { "forge-cms": { "command": "pnpm", "args": ["exec", "forge-cms-mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.forge-cms]
command = "pnpm"
args = ["exec", "forge-cms-mcp"]
```

No token, password, `AUTH_SECRET` or Cloudflare credential is needed or accepted.

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
`forgecms-migrations-recovery`. Copy them to where your agent reads project skills, for example:

```bash
mkdir -p .claude/skills && cp -R node_modules/@forge-cms/agent/skills/* .claude/skills/
mkdir -p .agents/skills && cp -R node_modules/@forge-cms/agent/skills/* .agents/skills/
```

## Security boundary

One project directory, fixed at start-up, read through a bounded reader (a fixed list of conventional files, size caps, no symlink out of the project). It never returns file contents or secret values - only names, versions and
findings - and has no tool that writes, executes, deploys, migrates or reads an arbitrary path.

Full guide: [Agent Kit](https://github.com/Andersseen/ForgeCMS/blob/main/apps/www/src/content/docs/agent-kit.md).
