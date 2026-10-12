---
'@forge-cms/runtime': patch
---

Collection and global metadata (`GET /api/content/collections`, `describeCollections`) no longer lists fields that no role can read or write (`access: { read: [], write: [] }`), such as the users collection's `passwordHash` and `_sessionVersion`. Found by the R03 staging rehearsal; no data was ever exposed, only the field names.
