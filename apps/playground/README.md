# ForgeCMS Playground — a personal sandbox

A scratchpad for trying ForgeCMS APIs locally. It builds a **real `ForgeCmsRuntime`** on in-memory
adapters and runs whatever you put in [`src/app/sandbox.ts`](src/app/sandbox.ts), printing the
result. The whole pipeline runs — access control, hooks, drafts, validation, relation population —
with no server, no database and no HTTP.

```sh
pnpm dev:playground
```

Then edit `src/app/sandbox.ts` and save; the page re-runs on hot reload.

## What goes where

| App                    | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `apps/playground`      | **This.** Private, disposable, break it freely. Not deployed, not a demo. |
| `apps/demo-aesthetics` | The realistic demo: a clinic site + CMS, the thing to show people.        |
| `apps/www`             | The landing page and the generic admin.                                   |

Two things to keep in mind:

- Each scenario gets a **fresh runtime**, so state never leaks between them.
- Calls default to `overrideAccess: true` (trusted server-side code). Pass
  `overrideAccess: false, user: null` to see what an anonymous visitor would get — which is how
  access rules and draft visibility become observable.
