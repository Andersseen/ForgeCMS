# ForgeCMS WWW

Official Analog.js landing app for ForgeCMS.

```sh
pnpm dev:www
```

## Languages (spec 101)

The public site is served in English (`/`), Spanish (`/es`) and Ukrainian (`/uk`). The URL decides
the language; [Etyma](https://github.com/Andersseen/etyma) renders it and
[Glossa](https://glossa.andersseen.dev) (project `forge-cms`) holds the UI catalogs.

```sh
pnpm --filter @forge-cms/www i18n:check   # validate the catalog snapshot (also runs in build)
pnpm --filter @forge-cms/www i18n:pull    # refresh src/app/i18n/catalogs from Glossa
GLOSSA_TOKEN=… pnpm --filter @forge-cms/www i18n:push   # owner only: create missing catalogs in Glossa
```

Translated docs live in `src/content/<locale>/docs/<slug>.md`; an article without one stays
English-only. See [`docs/specs/101-www-i18n-glossa-etyma.md`](../../docs/specs/101-www-i18n-glossa-etyma.md).
