---
'@forge-cms/angular': patch
---

Add opt-in public result transfer for server rendering (spec 080): `collectionResource(params, { transfer: 'public' })` and `documentResource(params, { transfer: 'public' })` serialize a successful, anonymous SSR result with Angular's `TransferState` so the first browser render hydrates from it instead of repeating the read. Only an anonymous client may opt in (`credentials: 'omit'`, no `authToken`, no forwarded `Authorization`); otherwise creating the resource throws a `TypeError`. Errors are never transferred, the state only lasts for the first hydration, and nothing changes for resources that do not opt in. New exported type `ForgeResourceOptions`.
