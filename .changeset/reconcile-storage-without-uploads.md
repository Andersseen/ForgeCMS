---
'@forge-cms/runtime': patch
---

`runtime.reconcileStorage()` is now a no-op that returns an empty report when no collection is
upload-enabled. It used to throw `Collection '_forge_storage_intents' not registered` on such a site,
because `syncSchema()` only creates the intents table where uploads exist. Found by the roadmap 0.7
M03 upgrade/backup rehearsal (spec 073), whose recovery runbook runs `reconcileStorage()` after every
restore.
