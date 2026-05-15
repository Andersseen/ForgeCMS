# devflare-cms

An experimental Payload-like CMS foundation for Angular and Analog.js developers.

## Goal

Devflare CMS aims to become a developer-first, TypeScript-native CMS that feels natural in Angular and Analog.js projects. This repository is only the initial monorepo foundation: package boundaries, contracts, testing, and a small schema DSL prototype.

## Status

Experimental and not production-ready. The CMS runtime, database adapters, auth adapters, storage adapters, CRUD handlers, and admin UI are intentionally not implemented yet.

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:watch
pnpm lint
pnpm typecheck
pnpm format
pnpm format:check
pnpm clean
```

## Monorepo Structure

```txt
apps/
  playground/   Analog.js playground for trying future CMS APIs

packages/
  core/         Base schema DSL and public core types
  db/           DatabaseAdapter contract
  auth/         AuthAdapter contract
  storage/      StorageAdapter contract
  api/          Future CRUD/API handler helpers
  admin/        Placeholder for the future Angular admin package
  testing/      Shared test helpers
```

## License

MIT
