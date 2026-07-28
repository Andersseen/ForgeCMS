---
name: implement-spec
description: Implement an approved spec from docs/specs/ end to end, following the SDD workflow — mark in-progress, work the checklist with per-step checks, then close out with tests, changeset, STATE.md, and the spec outcome note.
disable-model-invocation: true
---

# Implement an approved ForgeCMS spec

Argument: a spec number or slug (`044`, `044-add-globals`). If none was given, ask which spec —
do not guess from context.

This skill is the literal execution of steps 3–7 of [docs/SDD.md](../../../docs/SDD.md). Follow it
in order. The failure mode this exists to prevent is a spec that gets implemented but never closed
out — no changeset, no `STATE.md` update, status still `in-progress`.

## 1. Check approval

Open the spec. Read the header.

- `Status: approved` → proceed.
- `Status: draft` → **stop.** Agents must not self-approve. Report that the spec is still a draft and
  ask the human to approve it. The one exception: the user's message in this session is itself the
  approval ("implement spec 044" counts). If so, say you're treating it that way, then proceed.
- `Status: done` → stop and report. Ask whether they want a follow-up spec instead.
- `Status: in-progress` → work is resuming. Read the checklist to see what's already ticked.

## 2. Orient, then re-read the spec

If you haven't this session: [CLAUDE.md](../../../CLAUDE.md), [docs/STATE.md](../../../docs/STATE.md),
and skim [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Then re-read the spec you are about to build — **especially Acceptance Criteria and Non-goals**.
The non-goals are what stop you from building more than was asked.

Set up the branch (`feature/...` off `main`, per CONVENTIONS.md), and write the branch name into the
spec header's `Branch:` field. Set `Status: in-progress`.

## 3. Implement in small steps

Work the spec's implementation-plan checklist in order. **Tick each item off in the spec file as you
complete it** — the file is the progress record, not your context window.

After each meaningful step, run the checks for the package you just touched:

```bash
pnpm --filter @forge-cms/<pkg> test
pnpm --filter @forge-cms/<pkg> typecheck
```

Do not batch failures to the end. On a fresh clone or after touching a package's public types, you
may need `pnpm build` first — `tsconfig.base.json` maps `@forge-cms/*` to `packages/*/dist/index.d.ts`,
so typecheck reads the built `.d.ts`, not the source.

Rules that are easy to break while implementing (full list in
[docs/CONVENTIONS.md](../../../docs/CONVENTIONS.md)):

- Relative imports inside `packages/*` carry the **`.js` extension** — `from './validation.js'`.
- Import other packages through their entry point only (`@forge-cms/db`), never a deep `src/` path.
  The single exception is `@forge-cms/testing/contracts`.
- `exactOptionalPropertyTypes` — conditional spreads, never pass `undefined`.
  `noUncheckedIndexedAccess` — guard indexed access.
- New logic goes in `packages/runtime/src/operations.ts` (the Local API), not
  `handlers.ts` (transport only) and not in the Analog route files (keep those thin).
- Don't change the response envelope: `{ data, meta }` / `{ data }` / `{ error, details? }` / `204`.
- A new adapter **must** run the contract suite from `@forge-cms/testing/contracts`.
- New logic ships with tests; a bug fix ships with a regression test.

## 4. If reality contradicts the spec — stop

If you discover the spec assumed something false, missed a constraint, or specified an API that
can't work: **stop coding.** Update the spec to describe what's actually true, and surface the change
to the human before continuing. Do not silently diverge — the spec is the source of truth for intent,
and a spec that no longer matches the code is worse than no spec.

## 5. Verify

Run every item in the spec's Test plan. Then the full gates, in this order:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Then walk the Acceptance Criteria one at a time and state, for each, the command or test that proves
it. If a criterion isn't checkable as written, say so rather than declaring it met.

Run `pnpm format` before committing — `format:check` is the **first** step in CI, so a formatting
miss fails the pipeline before anything else runs.

## 6. Close out

All four, every time:

1. **Changeset** — required if anything under `packages/*` changed: `pnpm changeset`. Pick the
   right bump per package and write a real description (look at `.changeset/*.md` for the house
   style: what changed, why, and what's explicitly out of scope). Commit the generated file.
2. **`docs/STATE.md`** — update the affected rows, the "Known issues" and "Suggested next steps"
   lists, and the date at the top. It's a snapshot of reality, not a wishlist.
3. **The spec** — set `Status: done` and fill the **Outcome** section: one line on what shipped, plus
   any divergence from the plan.
4. **`docs/DEMO-FINDINGS.md`** — only if this spec closed a `FINDING n`: mark the row and note what
   fixed it. Never "fix" a finding by editing `packages/*` without updating that doc.

## 7. Report

Summarize what changed **versus the spec**: acceptance criteria met, anything deferred, any
divergence and why. Name the gate results explicitly — if something failed, say so with the output
rather than reporting success.
