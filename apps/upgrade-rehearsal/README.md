# @forge-cms/upgrade-rehearsal (private, not deployed)

The roadmap 0.7 release gate ([spec 073](../../docs/specs/073-historical-upgrade-and-backup-restore-rehearsal.md),
M03). It proves that installations written by **older ForgeCMS releases** upgrade through the
documented path (`planSchema()` → reviewed `runMigrations()` → clean plan) and that an upgraded
installation survives a backup and a restore into an isolated, empty environment — on an on-disk
libSQL database and on local D1 + R2 (workerd). It consumes only the public `@forge-cms/*` entry
points. The operator runbook it backs is [docs/BACKUP-RESTORE.md](../../docs/BACKUP-RESTORE.md).

```bash
pnpm build          # once: workspace packages resolve through dist/
pnpm test:upgrade   # from the repo root; offline, deterministic, ~20 s
```

`pnpm test` runs only the fast part (fixture integrity + backup helper failure modes).

## Layout

| Path                                 | What it is                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `fixtures/upgrades/<version>/`       | Committed historical fixtures: `database.sql`, `storage/`, `storage-manifest.json`, `manifest.json` |
| `generator/`                         | Maintainer-only regeneration from the published npm packages (network)                              |
| `src/model.ts`                       | The application **today**: collections, global, and its append-only reviewed migrations             |
| `src/verify.ts`                      | Behavioral assertions shared by both lanes and both profiles                                        |
| `src/backup.ts`                      | The rehearsal's backup format: DB file + objects named `sha256(key).bin` + checksummed manifest     |
| `src/libsql.ts`, `src/cloudflare.ts` | Environments: cold libSQL file copy; isolated Wrangler/Miniflare directories for D1/R2              |
| `test/`                              | `fixtures`, `backup` (fast); `upgrade-libsql`, `upgrade-d1-r2` (the rehearsal)                      |

## Fixtures

Each fixture was written **by that release**: the generator installs the published
`@forge-cms/*@<version>` tarballs and seeds the same small model through their public API, once on
libSQL and once on local D1/R2. Both runs must produce byte-identical data (they do for every audited
release), so one `database.sql` serves both profiles. Ids, clock and random bytes are deterministic, so
a regeneration is byte-identical. The manifest records npm integrity, the publishing source commit,
row counts, features and fixture-only test credentials, plus a SHA-256 for every file;
`test/fixtures.test.ts` fails on any change. Fixtures are excluded from Prettier and from end-of-line
conversion.

```bash
pnpm fixtures:upgrade:generate 0.4.0            # refuses: the fixture exists
pnpm fixtures:upgrade:generate 0.4.0 --force    # deliberate; review the diff
```

Checkpoints: `0.4.0` (baseline), `0.6.0` (full history snapshots, localized values, `_sessionVersion`,
storage intents, bootstrap claim), `0.8.0` (existing `_forge_schema` baseline). Why the other releases
need no fixture is in spec 073 §3.
