---
'@forge-cms/runtime': patch
---

Fix `handleUpdate` partial validation so that required fields already present on the stored record are not required to be resent in a PUT body.
