# ForgeCMS - Contexto del Proyecto

> Este archivo mantiene el estado y contexto del proyecto entre sesiones.
> Actualizar despues de cada fase completada.

---

## Informacion General

| Campo | Valor |
|---|---|
| Nombre | ForgeCMS |
| Descripcion | CMS experimental tipo Payload para Angular y Analog.js |
| Repo | https://github.com/forge-cms/forge-cms |
| License | MIT |
| Package Manager | pnpm 10.11.0 |
| Node | >= 20.19.0 |

---

## Estructura del Monorepo

```
ForgeCMS/
├── apps/
│   ├── www/               # Landing app (Analog.js + Angular + Tailwind)
│   └── playground/        # Prototipo de API CMS
├── packages/
│   ├── core/              # Schema DSL y tipos base
│   ├── db/                # Contrato DatabaseAdapter
│   ├── auth/              # Contrato AuthAdapter
│   ├── storage/           # Contrato StorageAdapter
│   ├── api/               # Helpers CRUD/API (futuro)
│   ├── admin/             # Placeholder para Angular admin
│   └── testing/           # Helpers de testing compartidos
├── turbo.json             # Configuracion de Turborepo
├── pnpm-workspace.yaml    # Workspaces de pnpm
├── eslint.config.mjs      # ESLint global
├── vitest.config.ts       # Configuracion base de Vitest
├── tsconfig.base.json     # TypeScript base estricto
└── wrangler.toml          # Configuracion Cloudflare Pages
```

---

## Stack Tecnologico

- **Framework:** Angular 21.2.10 + Analog.js (Vite plugin)
- **Lenguaje:** TypeScript 5.9.2 (strict mode)
- **Styling:** TailwindCSS 4.3.0 + VoltUI Components
- **Testing:** Vitest 4.1.6 (unit) + Playwright 1.60.0 (e2e)
- **Monorepo:** pnpm workspaces + Turborepo 2.9.14
- **Deploy:** Cloudflare Pages (Wrangler 4.91.0)

---

## Estado Actual de los Packages

| Package | Estado | Notas |
|---|---|---|
| `@forge-cms/core` | Funcional | Schema DSL con tipado fuerte + validacion en runtime. |
| `@forge-cms/db` | Placeholder + InMemory | Interface definida. `InMemoryDatabaseAdapter` + contract tests. |
| `@forge-cms/auth` | Placeholder + InMemory | Interface definida. `InMemoryAuthAdapter` + contract tests. |
| `@forge-cms/storage` | Placeholder + InMemory | Interface definida. `InMemoryStorageAdapter` + contract tests. |
| `@forge-cms/api` | Placeholder | Estructura CRUD inicial, sin handlers. |
| `@forge-cms/admin` | Placeholder | Solo exporta info del package. |
| `@forge-cms/testing` | Funcional | Helpers + `runDatabaseAdapterContractTests`, `runAuthAdapterContractTests`, `runStorageAdapterContractTests`. |

---

## Decisiones de Arquitectura (Registro)

### 1. Adapter Pattern
Los adapters (DB, Auth, Storage) son contratos puros (interfaces TypeScript). Las implementaciones concretas se hacen en packages separados futuros. Esto permite soporte multiple (D1, PostgreSQL, S3, etc.) sin acoplar el core.

### 2. Schema DSL Puro TypeScript
`defineCollection` y `defineField` generan metadatos en runtime pero el tipado principal es en compile-time via `CollectionData<T>`. No hay dependencia de clases o decoradores.

### 3. ESM Nativo
Todos los packages usan `"type": "module"`. No hay CommonJS.

### 4. Resolucion de Workspaces (Actualizado - Fase 3)
Las apps usan `vite-tsconfig-paths` para resolver `@forge-cms/*` via los `paths` del `tsconfig.json`. Esto elimina alias hardcodeados en Vite y usa la resolucion estandar de pnpm workspaces. Los `tsconfig.json` de las apps apuntan a `src/index.ts` de los packages para desarrollo rapido sin build previo.

---

## Issues Conocidos

1. Falta documentacion para contribuidores

---

## Fases Completadas

- [x] Fase 1: Seguridad y Configuracion Base
- [x] Fase 2: CI/CD Pipeline
- [x] Fase 3: Build System y Resolucion de Workspaces
- [x] Fase 4: Contract Tests para Adapters
- [x] Fase 5: Schema DSL - Runtime Validation
- [x] Fase 6: Refactor Landing App
- [x] Fase 7: Mejoras de ESLint y Calidad
- [ ] Fase 8: Documentacion y DX
- [ ] Fase 9: Polish Tecnico
- [ ] Fase 10: Preparacion para Publicacion

---

## Proxima Fase Recomendada

**Fase 8: Documentacion y DX**

Razon: Preparar el proyecto para colaboradores externos con CONTRIBUTING.md, CHANGELOG, y documentacion del API. Mejora la experiencia de desarrollo para quienes quieran usar o contribuir a ForgeCMS.

---

*Ultima actualizacion: 2026-05-19 (Fases 1, 2, 3, 4, 5, 6 y 7 completadas)*
