---
title: Schema upgrades
description: What happens to an existing database when you change a collection, and what ForgeCMS will and will not do for you.
group: Client & deploy
order: 5
---

> **Availability.** Drift detection (`planSchema()`, `SchemaDriftError`) is merged on `main` and ships
> in the first release after `0.7.0`. With `@forge-cms/*@0.7.0`, `syncSchema()` is additive only: it
> creates tables and adds columns, and it does **not** detect or refuse the changes below.

You change a collection in TypeScript. The database already holds rows written with the old
definition. What happens on the next start?

**ForgeCMS plans before it writes.** `runtime.syncSchema()` compares the schema you declared with the
schema actually stored. It applies only changes that cannot lose or reinterpret data. It refuses
everything else with a precise report and **executes nothing**. It does not run migrations for you.
Reviewed migration execution is the next roadmap step (0.7, M02) and does not exist yet.

```ts
await runtime.syncSchema(); // still the only call a fresh or additive setup needs
```

| Situation                            | What `syncSchema()` does                               |
| ------------------------------------ | ------------------------------------------------------ |
| Fresh database                       | Creates every table.                                   |
| Only safe additive changes           | Applies them all in one transaction.                   |
| Anything that needs a data migration | Throws `SchemaDriftError`. Nothing runs, in any table. |

## Check before you deploy

`planSchema()` is read-only. Run it against a copy of production, or from a deploy check:

```ts
import { formatSchemaPlan, isSchemaDriftError } from '@forge-cms/db';

const plan = await runtime.planSchema();
console.log(formatSchemaPlan(plan)); // table/column/index names and counts, never row values
if (plan.blocking) process.exit(1);

try {
  await runtime.syncSchema();
} catch (err) {
  if (isSchemaDriftError(err)) console.error(formatSchemaPlan(err.plan));
  throw err;
}
```

## What counts as safe

**Applied automatically:** a new collection or global, a new optional field, a new required field on
an empty table, `drafts`/`upload` on an empty table, a new non-unique index, and a new unique index
when the existing data has no duplicates.

**Refused until you migrate the data yourself:**

- a removed or **renamed** field (a rename is never guessed; it looks like a removal plus an addition);
- a changed storage type (`text` → `number`);
- `localized` or relation `many` switched on or off;
- a new required field on a table with rows;
- `drafts`/`upload` enabled on a table with rows;
- `unique` ⇄ `index` changes;
- a new unique index over duplicate rows.

**Reported as information only:** a stale non-unique index, a changed default, and compatible text
kinds (`text` ⇄ `textarea`).

A `defaultValue` is applied when a document is created. It is never written into existing rows, and
it is never a backfill.

## Your first upgrade of an existing database

ForgeCMS records a small semantic baseline per table in `_forge_schema` after each successful sync.
A database created before drift detection has none. The first sync can only compare what SQLite
metadata shows (columns, types, indexes), and records the baseline from there. Semantic changes you
made _before_ that first sync (for example switching `localized` on) cannot be detected after the
fact.

## Where this is going

- **Now:** detect drift and refuse it safely (roadmap 0.7, M01).
- **Next:** reviewed, ordered migrations with applied-history checks (M02).
- **Then:** tested upgrade and backup/restore rehearsals on D1 and libSQL (M03).

The full reference, including the complete change matrix, is `docs/SCHEMA-UPGRADES.md` in the
repository.
