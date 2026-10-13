# QUICKSTART — build your first ForgeCMS

There are two canonical starting paths. Both are written for a project **outside this monorepo**, install only published `@forge-cms/*` packages, and are
verified: `pnpm docs:verify:consumers` installs each one into a clean temporary project from the packed tarballs (strict peers, no workspace shortcuts), builds it and
runs it.

| You are…                                        | Follow                                                                          | Packages                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A server/TypeScript developer (no Angular)      | [Server quickstart](../apps/www/src/content/docs/server-quickstart.md)          | `core` · `db` · `auth` · `storage` · `api` · `runtime`         |
| An Angular/Analog developer who wants the admin | [Angular/Analog quickstart](../apps/www/src/content/docs/angular-quickstart.md) | the above + `angular` · `admin` + the documented Angular peers |

Prerequisites for both: **Node >= 22**, **pnpm 10**, TypeScript 5.9 with strict ESM output. The same pages are published at
<https://forge-cms.pages.dev/docs/server-quickstart> and <https://forge-cms.pages.dev/docs/angular-quickstart>.

After a quickstart:

- the long form with users, drafts, uploads and both durable profiles: [small project guide](../apps/www/src/content/docs/small-project-guide.md);
- going to production: [deployment](../apps/www/src/content/docs/deployment.md), then [BACKUP-RESTORE.md](BACKUP-RESTORE.md) and [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md);
- something broke: [troubleshooting](../apps/www/src/content/docs/troubleshooting.md);
- every export and option: [REFERENCE.md](REFERENCE.md).

To work on ForgeCMS itself rather than use it, see [CONTRIBUTING.md](../CONTRIBUTING.md) and [../CLAUDE.md](../CLAUDE.md).
