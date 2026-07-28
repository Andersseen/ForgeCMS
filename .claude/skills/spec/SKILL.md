---
name: spec
description: Draft a new ForgeCMS spec in docs/specs/ from TEMPLATE.md. Use when a change needs a spec per docs/SDD.md — a new package, adapter, or API endpoint; a change to an adapter contract or the API envelope; a new field kind or runtime feature; or a multi-file feature in an app.
---

# Draft a ForgeCMS spec

You are writing a spec that **a different, weaker model will implement without you present**.
Every ambiguity you leave behind becomes a wrong implementation. Write for that reader.

## Step 0 — Does this need a spec at all?

From [docs/SDD.md](../../../docs/SDD.md):

| Change                                                            | Spec?                                    |
| ----------------------------------------------------------------- | ---------------------------------------- |
| New package, new adapter, new API endpoint                        | Required                                 |
| Change to an adapter contract or the API envelope                 | Required                                 |
| New field kind, runtime feature (hooks, access control)           | Required                                 |
| Multi-file feature in an app (new admin page, auth flow)          | Required                                 |
| Bug fix, typo, refactor with no behavior change, test-only change | No — just do it (with a regression test) |
| Doc updates, CI tweaks                                            | No — just do it                          |

Rule of thumb: if you can't finish it in one sitting, or it changes a public surface, write a spec.
If it doesn't need one, say so and offer to just do the work instead. Don't write ceremony specs.

## Step 1 — Orient

Read, if you haven't already this session:

- [CLAUDE.md](../../../CLAUDE.md) — hard rules
- [docs/STATE.md](../../../docs/STATE.md) — what actually exists today (trust this over the README)
- [docs/ROADMAP.md](../../../docs/ROADMAP.md) — whether this is already a numbered roadmap item
- [docs/DEMO-FINDINGS.md](../../../docs/DEMO-FINDINGS.md) — if the work addresses a `FINDING n`,
  cite the finding number in Context and plan to update its row

Then grep `docs/specs/` for an existing spec covering this. Superseding an existing spec is often
the right move — say so rather than writing a duplicate.

## Step 2 — Get the number and scaffold

```bash
.claude/scripts/next-spec-number.sh
```

Create `docs/specs/NNN-short-slug.md` by copying
[docs/specs/TEMPLATE.md](../../../docs/specs/TEMPLATE.md). Slug is kebab-case and imperative
(`add-globals`, `migrate-admin-to-signals`).

Header fields: `Status: draft`, `Author: agent draft` (unless a human names themselves),
`Date:` today, `Branch:` left blank until implementation, `Affected packages/apps:` the real list —
this is what tells the implementer where changesets and contract tests apply.

## Step 3 — Write it

Fill every section. The sections that carry the weight:

**Design — show the exact public API surface.** SDD calls this "the section weaker models rely on
most; ambiguity here multiplies downstream." Write real TypeScript: exported types, function
signatures, endpoint shapes with example request/response bodies, component selectors and inputs.
Not "add a filter option" — the actual signature, the actual accepted values, the actual behavior on
invalid input and empty results. If you are changing a stable contract (an adapter interface, the
API envelope), show before/after side by side.

**Non-goals — be specific and slightly paranoid.** These are the cheapest scope-creep prevention
available. List the things a reasonable implementer would assume are included but aren't.

**Implementation plan — an ordered checklist of small steps**, each naming the file or package it
touches. The implementer ticks these off in the file as they go. If you exceed ~10 items, the spec
is too big — split it. One spec is roughly one PR. Always end with the close-out steps:
tests, changeset (if `packages/*` changed), `docs/STATE.md`.

**Test plan — name the actual tests.** Which `*.test.ts` files gain which cases. For a new adapter,
state explicitly which contract suite from `@forge-cms/testing/contracts` must run
(`runDatabaseAdapterContractTests`, etc.) — this is a hard rule, not a suggestion. Include manual
checks where they're the only real proof (`pnpm dev:www` → `/admin/collections` shows X).

**Acceptance criteria — each one mechanically checkable** by running a command or a test.
"Works well" is not a criterion. "`GET /api/v1/posts?limit=abc` returns 400" is. The last criterion
is always `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

**Open questions — leave them in.** A draft is allowed to have them; they're the whole point of
showing the draft to a human. They must be empty before the status can become `approved`, and the
answers move into Design.

Respect the repo's hard rules while designing — ESM with `.js` extensions on relative imports inside
`packages/*`, entry-point-only imports, the stable response envelope
(`{ data, meta }` / `{ data }` / `{ error, details? }` / `204`), business logic in
`packages/runtime/src/operations.ts` rather than the HTTP layer, and `overrideAccess` defaulting to
`true` on Local API calls but `false` from HTTP. A spec that quietly violates one of these will
produce an implementation that violates it.

## Step 4 — Stop

Present the draft: the number, the goal in one line, the non-goals, and any open questions you left.

**Then stop. Do not implement it, and do not mark it `approved`.** SDD is explicit: agents may write
drafts and implement approved specs, but **agents must not self-approve a spec**. Implementation
starts only after a human maintainer says "build this" — an instruction like "implement spec 044"
counts as that approval, and `/implement-spec` is the skill that does it.
