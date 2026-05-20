# ForgeCMS - Plan de Mejoras

> Plan estructurado de mejoras para el proyecto ForgeCMS, ordenado de más crítico/urgente a menos.
> Cada fase está diseñada para ser abordada en una sesión de trabajo individual.
> **No ejecutes todo de golpe. Enfocate en UNA fase por sesión.**

---

## Estado del Proyecto

- **Nombre:** ForgeCMS
- **Descripción:** CMS experimental tipo Payload para Angular/Analog.js
- **Arquitectura:** Monorepo con pnpm workspaces + Turborepo
- **Stack:** TypeScript 5.9, Angular 21, Analog.js, Vite, Vitest, Playwright, TailwindCSS 4, Cloudflare Pages
- **Packages:** core, db, auth, storage, api, admin, testing
- **Apps:** www (landing), playground (API prototype)

---

## Fase 1: Seguridad y Configuracion Base (CRITICO)

**Objetivo:** Prevenir publicaciones accidentales y establecer bases solidas.

- [x] Cambiar `private` a `true` en `package.json` raiz
- [x] Anadir archivo `LICENSE` (MIT) en la raiz
- [x] Crear `.nvmrc` con `20.19.0`
- [x] Mejorar `.npmrc` con configuraciones de pnpm (`auto-install-peers=true`, `publish-branch=main`)
- [x] Verificar que cada package individual que SE publicara tenga `private: false` y `publishConfig` correcto

**Archivos afectados:**
- `/package.json`
- `/.npmrc`
- `/.nvmrc` (nuevo)
- `/LICENSE` (nuevo)
- `/packages/*/package.json`

**Criterio de terminacion (COMPLETADO):**
- [x] `private: true` en root package.json
- [x] Archivo `LICENSE` existe en raiz
- [x] `.nvmrc` existe
- [x] `pnpm install` funciona correctamente con nueva config

---

## Fase 2: CI/CD Pipeline con GitHub Actions (CRITICO)

**Objetivo:** Automatizar calidad en cada PR y merge.

- [x] Crear `.github/workflows/ci.yml` - Pipeline principal (lint, typecheck, test unitarios, build)
- [x] Crear `.github/workflows/e2e.yml` - Pipeline de Playwright para `apps/www`
- [x] Crear `.github/workflows/deploy.yml` - Deploy automatico a Cloudflare Pages en merges a main
- [ ] Configurar branch protection rules manualmente en GitHub (requerir checks de CI antes de merge)

**Archivos afectados:**
- `/.github/workflows/ci.yml` (nuevo)
- `/.github/workflows/e2e.yml` (nuevo)
- `/.github/workflows/deploy.yml` (nuevo)

**Criterio de terminacion (PARCIAL - requiere configuracion manual en GitHub):**
- [x] Cada PR ejecuta CI automaticamente (workflow creado)
- [x] E2E corre en CI (workflow creado)
- [x] Deploy a Cloudflare funciona desde GitHub Actions (workflow creado)
- [ ] Branch protection rules activados en GitHub (configurar en Settings > Branches)

---

## Fase 3: Build System y Resolucion de Workspaces (ALTO)

**Objetivo:** Eliminar alias hardcodeados y usar resolucion nativa de pnpm workspaces.

- [x] Eliminar alias manuales de `fileURLToPath` en `apps/*/vite.config.ts`
- [x] Instalar `vite-tsconfig-paths` en apps para resolucion via tsconfig paths
- [x] Verificar que `turbo run build` funcione correctamente con dependencias entre packages

**Archivos afectados:**
- `/apps/www/vite.config.ts` (eliminados alias manuales, agregado `vite-tsconfig-paths`)
- `/apps/playground/vite.config.ts` (eliminados alias manuales, agregado `vite-tsconfig-paths`)
- `/apps/www/package.json` (dependencia `vite-tsconfig-paths`)
- `/apps/playground/package.json` (dependencia `vite-tsconfig-paths`)

**Criterio de terminacion (COMPLETADO):**
- [x] `pnpm build` compila todo sin errores
- [x] `pnpm test` pasa en todos los packages (10/10)
- [x] `pnpm typecheck` pasa en todos los packages (10/10)
- [x] No hay alias hardcodeados `fileURLToPath` en ningun `vite.config.ts`
- Las apps pueden importar desde `@forge-cms/*` sin alias manuales
- Los types se resuelven correctamente en IDE

---

## Fase 4: Contract Tests para Adapters (ALTO)

**Objetivo:** Establecer base de calidad para futuras implementaciones de adapters.

- [x] Crear `runDatabaseAdapterContractTests()` en `packages/testing`
- [x] Crear `runAuthAdapterContractTests()` en `packages/testing`
- [x] Crear `runStorageAdapterContractTests()` en `packages/testing`
- [x] Definir suite de tests para `DatabaseAdapter` (8 tests)
- [x] Definir suite de tests para `AuthAdapter` (5 tests)
- [x] Definir suite de tests para `StorageAdapter` (5 tests)
- [x] Crear implementaciones mock/minimas que pasen los contract tests
- [x] Integrar los contract tests en el pipeline de CI (ya estaba en Fase 2)

**Archivos afectados:**
- `/packages/testing/src/contracts/` (nueva carpeta)
- `/packages/testing/src/index.ts`
- `/packages/db/src/index.test.ts`
- `/packages/auth/src/index.test.ts`
- `/packages/storage/src/index.test.ts`

**Criterio de terminacion (COMPLETADO):**
- [x] Existen funciones de contract tests exportadas desde `packages/testing`
- [x] Cada adapter package tiene tests que verifican su interface/contract
- [x] Implementaciones `InMemory*` creadas para DB, Auth y Storage
- [x] Tests pasan: 8 (db) + 5 (auth) + 5 (storage) = 18 contract tests
- [x] Los tests pasan en CI (workflows ya configurados en Fase 2)

---

## Fase 5: Schema DSL - Runtime Validation (MEDIO)

**Objetivo:** El DSL actual es puro type-level. Agregar validacion en runtime.

- [x] Implementar `validateField()` en `packages/core`
- [x] Anadir validaciones para: required, min/max (number), minLength/maxLength (text), date format
- [x] Implementar `validateCollection()` que valide un objeto contra una coleccion
- [x] Crear tests exhaustivos para las validaciones (24 tests)
- [ ] Documentar API de validacion (se hara en Fase 8)

**Archivos afectados:**
- `/packages/core/src/validation.ts` (nuevo - motor de validacion)
- `/packages/core/src/validation.test.ts` (nuevo - 24 tests)
- `/packages/core/src/index.ts` (exports agregados)

**Criterio de terminacion (COMPLETADO):**
- [x] Se puede validar un objeto de datos contra una coleccion definida
- [x] `validateField()` valida campos individuales con todos los tipos
- [x] Tests cubren casos de exito y error (24 tests, todos pasan)
- [x] Tipos se mantienen fuertes
- [x] Validaciones soportadas: required, minLength/maxLength, min/max, type checks para text/number/boolean/date/relation

---

## Fase 6: Refactor Landing App (MEDIO)

**Objetivo:** Separar componentes monoliticos y mejorar mantenibilidad.

- [x] Extraer `HeaderComponent` de `app.component.ts`
- [x] Extraer `HeroSectionComponent`
- [x] Extraer `ArchitectureSectionComponent`
- [x] Extraer `PackagesSectionComponent`
- [x] Extraer `RoadmapSectionComponent`
- [x] Usar `OnPush` change detection en componentes presentacionales
- [ ] Mejorar accesibilidad (aria-current, skip links, focus management) - se puede hacer en Fase 9

**Archivos afectados:**
- `/apps/www/src/app/app.component.ts` (reescrito - 28 lineas)
- `/apps/www/src/app/components/header.component.ts` (nuevo)
- `/apps/www/src/app/components/hero-section.component.ts` (nuevo)
- `/apps/www/src/app/components/architecture-section.component.ts` (nuevo)
- `/apps/www/src/app/components/packages-section.component.ts` (nuevo)
- `/apps/www/src/app/components/roadmap-section.component.ts` (nuevo)

**Criterio de terminacion (COMPLETADO):**
- [x] `app.component.ts` tiene 28 lineas (objetivo: < 30)
- [x] Cada seccion es un componente standalone independiente
- [x] Todos los componentes usan `ChangeDetectionStrategy.OnPush`
- [x] Tests pasan: `pnpm test` 11/11 successful
- [x] Build pasa: `pnpm build` 9/9 successful

---

## Fase 7: Mejoras de ESLint y Calidad (MEDIO)

**Objetivo:** Detectar errores comunes y mantener consistencia.

- [x] Anadir `@typescript-eslint/no-floating-promises`
- [x] Anadir `eslint-plugin-import` con regla `no-cycle`
- [x] Anadir `eslint-plugin-unicorn` para mejoras de codigo
- [x] Configurar reglas para preferir `node:` imports
- [x] Ejecutar `lint --fix` en todo el repo y corregir issues

**Archivos afectados:**
- `/eslint.config.mjs`
- Todo el codigo fuente

**Criterio de terminacion (COMPLETADO):**
- [x] `pnpm lint` pasa sin errores en 9/9 packages
- [x] No hay floating promises sin await/catch (`no-floating-promises` activo)
- [x] No hay imports ciclicos detectados (`import/no-cycle` activo)
- [x] Preferencia de `node:` imports (`unicorn/prefer-node-protocol` activo)
- [x] `pnpm test`, `pnpm build`, `pnpm typecheck` pasan sin errores

---

## Fase 8: Documentacion y DX (BAJO)

**Objetivo:** Preparar el proyecto para colaboradores externos.

- [x] Crear `CONTRIBUTING.md` con guia de pnpm + turbo + changesets
- [x] Crear `CODE_OF_CONDUCT.md`
- [x] Anadir `CHANGELOG.md` con contenido inicial
- [x] Configurar `@changesets/cli` para versionado semantico automatico
- [ ] Generar docs con TypeDoc para el API publico de `packages/core` (opcional, puede hacerse mas adelante)
- [x] Actualizar `README.md` con badges de CI y status de cada package

**Archivos afectados:**
- `/CONTRIBUTING.md` (nuevo)
- `/CODE_OF_CONDUCT.md` (nuevo)
- `/CHANGELOG.md` (nuevo)
- `/.changeset/` (nueva carpeta)
- `/README.md`

**Criterio de terminacion (COMPLETADO):**
- [x] `CONTRIBUTING.md` existe con guia completa de desarrollo
- [x] `CODE_OF_CONDUCT.md` existe (basado en Contributor Covenant)
- [x] `CHANGELOG.md` existe con contenido inicial del proyecto
- [x] `.changeset/config.json` configurado con `access: "public"`
- [x] Scripts `changeset` y `changeset:version` anadidos a `package.json`
- [x] `README.md` actualizado con badges CI, tabla de packages, y links a docs

---

## Fase 9: Polish Tecnico (BAJO)

**Objetivo:** Detalles que mejoran robustez y experiencia.

- [x] Revisar y fortalecer tests de Playwright (evitar checks de CSS inline fragiles)
- [x] Verificar configuracion de Wrangler para deploy correcto
- [ ] Anadir `husky` + `lint-staged` para pre-commit hooks (opcional)
- [x] Anadir `.vscode/settings.json` y `.vscode/extensions.json` recomendados
- [x] Revisar que todos los packages tengan `sideEffects: false` (ya estan bien)

**Archivos afectados:**
- `/apps/www/e2e/landing.spec.ts`
- `/wrangler.toml`
- `/.husky/` (opcional)
- `/.vscode/` (nuevo)

**Criterio de terminacion:**
- Tests de E2E son robustos (no dependen de CSS inline)
- Deploy funciona sin problemas
- VS Code sugiere las extensiones correctas al abrir el proyecto

---

## Fase 10: Preparacion para Publicacion (BAJO - Futuro)

**Objetivo:** Cuando el core este listo, poder publicar a npm facilmente.

- [x] Configurar `publishConfig` en packages publicables
- [x] Verificar que `files` y `exports` sean correctos para npm
- [x] Crear script `pnpm release` usando changesets
- [x] Documentar proceso de release en `CONTRIBUTING.md`
- [ ] Publicar version alpha `0.0.1-alpha.0` de `@forge-cms/core` (requiere npm auth)

**Archivos afectados:**
- `/packages/*/package.json`
- `/package.json` (scripts de release)

**Criterio de terminacion:**
- `pnpm release` publica versiones correctamente
- Los packages son instalables desde npm
- El tag `latest` no se afecta por versiones alpha

---

## Reglas de Trabajo

1. **Una fase por sesion.** No mezclar fases.
2. **Testar antes de declarar terminado.** Cada fase tiene criterios de terminacion.
3. **Actualizar este archivo.** Marcar con [x] las tareas completadas.
4. **Documentar decisiones.** Si se toma una decision de arquitectura, anotarla en `CONTEXT.md`.

---

*Ultima actualizacion: 2026-05-19*
