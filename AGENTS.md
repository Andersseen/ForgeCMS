# AGENTS.md

This repository is agent-friendly. The canonical agent guide is **[CLAUDE.md](CLAUDE.md)** — read it first, regardless of which AI tool you are.

Reading order:

1. [CLAUDE.md](CLAUDE.md) — commands, hard rules, gotchas.
2. [docs/STATE.md](docs/STATE.md) — current implementation status (the README is outdated on this).
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — package graph and data flow.
4. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — code style and required patterns.
5. [docs/SDD.md](docs/SDD.md) — spec-driven workflow; specs live in `docs/specs/`.

Non-negotiables (details in CLAUDE.md):

- pnpm only, Node >= 22, ESM only, TypeScript strict.
- Run `pnpm build` before `pnpm typecheck` on a fresh clone.
- Quality gates before finishing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- Changes under `packages/*` need a changeset and, for adapters, the contract tests from `@forge-cms/testing/contracts`.
- Keep the API response envelope stable: `{ data, meta }` / `{ data }` / `{ error, details? }` / `204`.
