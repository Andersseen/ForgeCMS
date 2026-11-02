# Website catalogs — generated, do not edit

These files are a snapshot of the Glossa project **`forge-cms`**
(<https://glossa.andersseen.dev>). Glossa is the source of truth for the website's UI copy
(spec 101); edit translations there, not here.

- `pnpm --filter @forge-cms/www i18n:pull` — refresh this snapshot from Glossa Public Delivery
  (no token). It refuses an invalid catalog, a missing locale, or source keys that differ from
  `../contract.generated.ts`.
- `pnpm --filter @forge-cms/www i18n:check` — offline validation (runs in every build).
- The production deploy job pulls from Glossa before building, so a published translation reaches
  the site on the next deploy even if this snapshot is older.

Adding or renaming a **key** is a code change: add it to `en.json` here and in Glossa, run
`i18n:contract`, use it in a component, and ship it in a PR. Lists are numbered objects
(`"0"`, `"1"`, …) because Glossa stores strings and objects only.
