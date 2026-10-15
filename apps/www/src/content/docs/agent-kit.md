---
title: Agent Kit (experimental)
description: A read-only local MCP server and an official skill pack so a coding agent can discover your ForgeCMS setup and follow the supported patterns.
group: Client & deploy
order: 8
---

> **Experimental.** `@forge-cms/agent` is development tooling. It is versioned with the other ForgeCMS packages, but its interfaces (tool names, resource ids, skill names) may change in a compatible 1.x minor
> and are **outside the stable 1.x public-surface guarantee**. Your application never needs it at runtime.

The Agent Kit gives an AI coding agent (Claude Code, Codex, ...) two things, both matched to the exact ForgeCMS version you installed:

- an **MCP server** (`forge-cms-mcp`, local stdio, **read-only**) that tells the agent how your project uses ForgeCMS and searches the bundled documentation;
- an official **skill pack** (eight focused skills) with the procedures for setup, content modelling, the admin, localization, auth and access, Cloudflare, Analytics, and migrations.

The agent still edits **your** project through its normal coding tools. The MCP provides safe context; it cannot write, run, deploy or read arbitrary files.

## The workflow

1. Create an Angular/Analog project and install the ForgeCMS packages (see the [Angular quickstart](/docs/angular-quickstart)).
2. Install the kit as a **dev** dependency: `pnpm add -D @forge-cms/agent`.
3. Connect your agent with one command: `pnpm exec forge-cms-agent init`.
4. Ask the agent to model the site ("add a `services` collection editable in Spanish and English").
5. The agent calls `forge_project_detect`, `forge_project_doctor` and `forge_docs_search`, and follows the skills.
6. **You review** the generated code.
7. Run the normal gates: `typecheck`, `lint`, `test`, `build`, then deploy as usual.

## Connect your agent

```bash
pnpm exec forge-cms-agent init
```

One command does both jobs:

- merges the MCP entry into `.mcp.json` (your other servers and keys are kept), and
- copies the eight skills into `.claude/skills/`.

It is idempotent, picks `pnpm`, `npm`, `yarn` or `bun` from your lockfile, writes only inside your project (never through a symlink), and never overwrites something you wrote unless you pass `--force`.

| Command / option                    | What it does                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `forge-cms-agent init`              | Connect the agent (`sync` is an alias)                                                       |
| `forge-cms-agent check`             | Writes nothing; exits 1 if the entry or a skill is missing or stale, so you can run it in CI |
| `--target claude,agents`            | Also install the skills to `.agents/skills/` (Codex and other agents that read that folder)  |
| `--dry-run`                         | Print the plan, change nothing                                                               |
| `--root <dir>`, `--package-manager` | Another project directory, or force the package manager                                      |

After upgrading ForgeCMS, run `pnpm exec forge-cms-agent sync` so the skills match the new version (`check` tells you when they do not).

**Codex** reads `~/.codex/config.toml`, which is outside your project, so `init` prints this snippet for you to add instead of writing it:

```toml
[mcp_servers.forge-cms]
command = "pnpm"
args = ["exec", "forge-cms-mcp"]
```

No token, password, `AUTH_SECRET` or Cloudflare credential is ever needed or accepted. The MCP server is `forge-cms-mcp` (local stdio, read-only); it inspects the directory it is started in, or `--root <dir>`.

### Manual setup

If you prefer to do it by hand, the `.mcp.json` entry is `{ "mcpServers": { "forge-cms": { "command": "pnpm", "args": ["exec", "forge-cms-mcp"] } } }` and the skills are plain `SKILL.md` files under
`node_modules/@forge-cms/agent/skills/` that you copy to `.claude/skills/` (or `.agents/skills/`). The Agentyx tool (0.11) has no supported way to install third-party packs yet, so there is no Agentyx manifest.

## The skills

| Skill                          | Teaches                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `forgecms-setup`               | packages, profile choice, runtime, client, linker, admin mount, first admin       |
| `forgecms-content-modeling`    | collections, globals, fields, drafts, versions, relations, uploads, hooks, limits |
| `forgecms-admin`               | admin routes, `basePath` (`/studio`), users workspace, navigation, composition    |
| `forgecms-localization`        | the exact supported localization contract and what is not supported               |
| `forgecms-auth-access`         | roles, row/field access, `overrideAccess`, sessions, CSRF, API keys, secrets      |
| `forgecms-cloudflare`          | D1, R2, bindings, secrets, durable profile, certified vs operator guarantees      |
| `forgecms-analytics`           | the experimental Analytics recipe and its privacy contract                        |
| `forgecms-migrations-recovery` | drift checks, reviewed migrations, backup and restore                             |

## What the MCP offers

Every tool is read-only and takes no path.

| Tool                     | Answers                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `forge_project_detect`   | Forge package versions, Angular/Analog/Vite, Cloudflare vs portable profile, admin mount, localization, analytics wiring |
| `forge_project_doctor`   | A few high-confidence Forge checks, each `pass`, `warning`, `error` or `unknown` (evidence, not proof)                   |
| `forge_docs_search`      | Searches the documentation and skills bundled with the installed version (offline)                                       |
| `forge_support`          | Supported and tested Node, Angular, Vite, Analog, profiles, and experimental status                                      |
| `forge_runtime_metadata` | The sanitized, anonymous `/api/v1/collections` metadata of a **running** app (http/https origin, no cookies or tokens)   |

Resources: `forge://docs/<guide>` (for example `forge://docs/quickstart`, `forge://docs/analytics`), `forge://skills/<skill>`, `forge://support` and `forge://project`.

### Security boundary

The server inspects one project directory chosen at start-up, through a bounded reader: only a fixed list of conventional files, a size cap per file, no symlink that leaves the project, no `.env`/`.dev.vars` content, no
directory recursion beyond a few levels. It returns summaries - binding **names** and package versions - never file contents or secret values. It has no `read_file`, `execute`, write, migrate or deploy tool, and it makes no
network request except an explicit `forge_runtime_metadata` call (GET, no redirects, 5-second limit, size cap). **It collects no telemetry**: nothing about your project, queries or tool use leaves your machine. Analytics is a separate, explicit
capability of your _site_.

### Version matching

The documentation corpus is bundled in the package and built from the same release; nothing is fetched from the internet. A project on `1.0.0-rc.N` gets the docs of `1.0.0-rc.N`.

## Example: a client site in Spanish and English

A realistic model - site settings, pages, services, posts and media - with Spanish and English copy, shared images and slugs, and an admin where the client edits content. The developer still builds the website UI;
the client edits content in the admin. This file is the one the repository tests against the real runtime (`pnpm test:demo`).

<!-- snippet: apps/demo-aesthetics/src/scenarios/client-site-collections.ts -->

```ts
import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';

const LOCALES = ['es', 'en'];
const isEditor = ({ user }: { user?: { role?: string } | null }): boolean =>
  user?.role === 'admin' || user?.role === 'editor';
const isAdmin = ({ user }: { user?: { role?: string } | null }): boolean => user?.role === 'admin';
const editorial = { read: () => true, create: isEditor, update: isEditor, delete: isAdmin };

/** Users stay admin-managed: editors write content, only admins manage people. */
export const users = defineUsersCollection();

/** Shared by every language: one file, localized alt text lives next to the picture that uses it. */
export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number()
  },
  access: editorial
});

/** Site-wide copy: one document, a locale map per localized field. */
export const siteSettings = defineGlobal({
  slug: 'siteSettings',
  locales: LOCALES,
  fields: {
    siteName: defineField.text({ required: true, localized: true }),
    tagline: defineField.text({ localized: true }),
    footerText: defineField.textarea({ localized: true }),
    logo: defineField.upload({ collection: 'media' })
  },
  access: { read: () => true, update: isEditor }
});

export const pages = defineCollection({
  slug: 'pages',
  drafts: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    description: defineField.textarea({ localized: true }),
    seoTitle: defineField.text({ localized: true }),
    seoDescription: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    hero: defineField.upload({ collection: 'media' })
  },
  access: editorial
});

export const services = defineCollection({
  slug: 'services',
  drafts: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'order'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    description: defineField.textarea({ localized: true }),
    seoTitle: defineField.text({ localized: true }),
    seoDescription: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    image: defineField.upload({ collection: 'media' }),
    imageAlt: defineField.text({ localized: true }),
    order: defineField.number()
  },
  access: editorial
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  versions: true,
  locales: LOCALES,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'publishedAt'] },
  fields: {
    title: defineField.text({ required: true, localized: true }),
    excerpt: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    publishedAt: defineField.date({ withTime: true }),
    cover: defineField.upload({ collection: 'media' })
  },
  access: editorial
});

export const collections = [users, media, pages, services, posts];
export const globals = [siteSettings];
```

What an agent finds through the kit for common requests: "make the title editable in Spanish and English" -> `forgecms-localization` (and the _Localization_ section of the collections guide); "mount the admin at `/studio`" ->
`forgecms-admin`; "enable client analytics" -> `forgecms-analytics` and the [Analytics guide](/docs/analytics); "prepare a migration" -> `forgecms-migrations-recovery`; "deploy D1 + R2" -> `forgecms-cloudflare`.

Localization is exactly what the runtime supports: top-level `text` and `textarea` fields marked `localized: true`. Localized rich text, blocks, arrays, uploads and relations do not exist yet.

## Limits

- Experimental, development-time, read-only; not a general CLI, not a hosted service, and not a content-generation or deployment agent.
- `forge_project_doctor` is static: it does not replace the TypeScript compiler, ESLint, your tests or `npm audit`.
- The visual page builder is not part of ForgeCMS.
