# SDD — Spec-Driven Development workflow

This repo uses lightweight spec-driven development: **non-trivial changes are specified in
`docs/specs/` before implementation.** The spec is the source of truth for *intent*; code review
checks the diff against the spec, not against vibes.

## When a spec is required

| Change | Spec? |
| --- | --- |
| New package, new adapter, new API endpoint | ✅ Required |
| Change to an adapter contract or the API envelope | ✅ Required (these are stable interfaces) |
| New field kind, runtime feature (hooks, access control) | ✅ Required |
| Multi-file feature in an app (new admin page, auth flow) | ✅ Required |
| Bug fix, typo, refactor with no behavior change, test-only change | ❌ Just do it (with a regression test) |
| Doc updates, CI tweaks | ❌ Just do it |

Rule of thumb: if you can't finish it in one sitting or it changes a public surface, write a spec.

## Spec lifecycle

Files live in `docs/specs/NNN-short-slug.md` (three-digit, incrementing — check existing files for
the next number). Copy [specs/TEMPLATE.md](specs/TEMPLATE.md).

```
draft → approved → in-progress → done
                 ↘ rejected / superseded
```

- **draft** — written by anyone (human or agent). Open questions allowed.
- **approved** — a human maintainer said "build this". All open questions resolved.
- **in-progress** — someone is implementing. Put the branch name in the spec header.
- **done** — merged; acceptance criteria verified. Add a one-line outcome note.

Agents may write drafts and implement approved specs. **Agents must not self-approve a spec** —
implementation starts only after human approval (an explicit instruction like "implement spec 003"
counts as approval).

## The agent workflow (follow literally)

1. **Orient** — read `CLAUDE.md`, `docs/STATE.md`, and skim `docs/ARCHITECTURE.md` if you haven't
   this session.
2. **Find or write the spec** — check `docs/specs/` for an existing one. If the task needs a spec
   and none exists, write a draft, present it, and stop for approval.
3. **Re-read the spec before coding** — especially Acceptance Criteria and Non-goals. Mark the spec
   `in-progress`.
4. **Implement in small steps**, following the spec's implementation plan checklist. Tick items off
   in the spec file as you go. After each meaningful step, run the affected package's checks
   (`pnpm --filter @forge-cms/<pkg> test` etc.) — don't batch failures.
5. **If reality contradicts the spec** (wrong assumption, missing constraint), STOP coding, update
   the spec, and surface the change to the human. Don't silently diverge.
6. **Verify** — run every item in the spec's Test Plan, then the full gates:
   `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
7. **Close out** — changeset if `packages/*` changed; update `docs/STATE.md`; mark the spec `done`
   with an outcome note; summarize what changed vs. the spec.

## Writing good specs (guidance for authors)

- **Small.** One spec ≈ one PR. If the plan has more than ~10 checklist items, split it.
- **Concrete API surface.** Show the exact exported types/signatures being added or changed — this
  is the section weaker models rely on most; ambiguity here multiplies downstream.
- **Explicit non-goals.** The cheapest way to prevent scope creep.
- **Testable acceptance criteria.** Each criterion should be checkable by running a command or a
  test — "works well" is not a criterion; "`GET /api/v1/posts?limit=abc` returns 400" is.
- **Name the affected packages** so the implementer knows where changesets and contract tests apply.
