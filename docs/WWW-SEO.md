# Official site search and sharing

The canonical origin is `https://forgecms.dev`, configured in `apps/www/src/app/site-config.mjs`.
Keep that as the only public canonical origin; the `forge-cms.pages.dev` hostname is a deployment
alias. The homepage, `/demo`, and every Markdown article in `apps/www/src/content/docs/` are the
indexable route inventory. `/api/` is disallowed by robots. `/admin/` stays crawlable so search
crawlers can observe its `noindex` response header; it is absent from the sitemap. These are crawl
signals, not access control. Admin middleware sends `X-Robots-Tag: noindex, nofollow` on function
responses; `_headers` also declares it for static responses where Cloudflare Pages applies that file.

`apps/www/public/robots.txt` is the site-owned crawler policy. Keep the canonical sitemap reference
in that file. `pnpm --filter @forge-cms/www generate:sitemap` regenerates `public/sitemap.xml` from
the real docs files and validates required frontmatter; the website build runs it automatically.
The sitemap deliberately has no `lastmod` values because source modification dates are not a
reliable publication date.

Analog prerenders only `/`, `/demo`, and the docs directory. Nitro remains enabled for the Pages API
and request-time routes. `/admin/**` is excluded from SSR and prerendering because it is
authenticated. Public pages hydrate in the browser; documentation Markdown remains the source of
truth. The Pages Function include list is limited to `/api/*` and `/admin/*`; public routes are
served from prerendered assets and unknown paths use the generated `404.html`. Route descriptions
come from docs frontmatter or route data. The shared head includes the
ForgeCMS social card and truthful WebSite/SoftwareSourceCode JSON-LD.

The Angular compiler is loaded only in development for Analog's JIT renderer. Production uses the
already AOT-compiled templates, so it does not ship the JIT compiler in the client entry chunk.

The production client entry measured in the build output was 684.88 kB (200.96 kB gzip) before
compiler gating and 542.06 kB (168.02 kB gzip) after it, a reduction of 142.82 kB raw and 32.94 kB
gzip. The 1.0 Lighthouse figures supplied by the maintainer are a baseline, not a repeatable local
measurement: Lighthouse CLI is not installed in this workspace. No post-change Lighthouse score or
field Core Web Vitals are claimed. Re-run mobile and desktop Lighthouse on the deployed canonical
domain and save repeated JSON reports before comparing audit scores or visual-completeness metrics.

The PR's production browser suite checks layout and clipping at 390, 768, 1440 and 1920 px, keyboard
focus, reduced motion, route navigation, and the showcase tabs. It does not compare pixel screenshots;
the changes leave page content styling untouched and only change the off-page share card plus server
rendering/head output.

Run the focused checks with:

```sh
pnpm --filter @forge-cms/www generate:sitemap
pnpm build:www
pnpm e2e:www:prod
```

For a local Lighthouse sample after building, serve the Pages output through the repository's
production test setup (`pnpm e2e:www:prod` uses `wrangler pages dev`). Record Chrome version,
mobile/desktop settings, throttling, route and repeated samples alongside any comparison. Lab
metrics are not field Core Web Vitals. Use the official URL Inspection tools in Google Search
Console and Bing Webmaster Tools to submit the sitemap and inspect fetched HTML; domain ownership
verification and indexing status require the site maintainer's accounts and are not implied by a
successful deployment.

Redirects between `www`, HTTP, and the Pages alias depend on Cloudflare zone configuration and must
be confirmed against the live deployment. Do not change zone-level settings as part of a site code
change. Security headers in `_headers` apply only where Cloudflare Pages applies static header
rules; verify function responses separately.
