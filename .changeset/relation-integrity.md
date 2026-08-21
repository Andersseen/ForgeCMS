---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
---

feat: add Relation integrity support (cascade, restrict, set-null on delete)

- Add `onDelete` option to RelationFieldOptions: 'restrict' | 'cascade' | 'set-null'
- Default behavior is 'restrict': prevents deletion if document is referenced
- 'cascade': deletes all documents that reference the deleted document
- 'set-null': sets relation fields to null in referencing documents
- Add relation integrity utilities: findRelationFields, findReferencingDocuments, checkDeleteRestrictions, handleCascadeDelete, handleSetNullOnDelete
- Add findOrphanedDocuments utility to detect documents with broken relations
- Integrate relation integrity checks into delete operation
- Add getCollections() method to OperationContext
- Update demo-aesthetics collections to use onDelete: 'set-null' for services relations
- Add 12 tests covering relation integrity functionality
