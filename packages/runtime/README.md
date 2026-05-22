# @forge-cms/runtime

Runtime orchestrator for ForgeCMS. Binds schema definitions, database/auth/storage adapters, and HTTP handlers into a cohesive CMS runtime.

## Responsibility

- Initialise and wire all adapters
- Sync database schema from collection definitions
- Provide CRUD request handlers that validate, authorise, and persist
- Expose a typed configuration API

## Status

**Early design phase** — contracts and config types are stabilising. No real request handling is implemented yet.
