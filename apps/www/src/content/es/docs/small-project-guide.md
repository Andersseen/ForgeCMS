---
title: Guía para un proyecto pequeño
description: Añade ForgeCMS a un proyecto pequeño de Angular/Analog —usuarios, entradas, autenticación con cookies y un panel de administración que funciona— de principio a fin.
group: Getting started
order: 4
---

Tienes un proyecto pequeño de Angular/Analog. Quieres usuarios, un inicio de sesión, un panel de
administración protegido y un par de tipos de contenido. Esta página es ese camino, de principio a
fin, y aquí nada es una aspiración: cada fragmento es el mismo código que demuestra
`apps/tiny-project` en este repositorio (spec 055), un consumidor deliberadamente diminuto, con el
estilo de un proyecto externo, construido solo sobre las exportaciones públicas de `@forge-cms/*` que
aparecen abajo.

## 1. Instalación

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/auth @forge-cms/db @forge-cms/storage \
  @forge-cms/angular @forge-cms/admin
```

Añade los adaptadores de tu perfil duradero (consulta el [§9](#9-cloudflare-frente-a-portable)):

```sh
pnpm add @forge-cms/cloudflare   # Cloudflare: D1 + R2
pnpm add @forge-cms/s3           # portable: libSQL (in @forge-cms/db) + S3
```

## 2. Definir usuarios y entradas

```ts
// server/collections.ts
import { defineCollection, defineField } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

export const users = defineUsersCollection();

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      autoGenerate: true,
      sourceField: 'title'
    }),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, posts];
```

`defineUsersCollection()` es la forma recomendada para `users`: email, nombre, un select de `role`
(`admin | editor | viewer`, con `viewer` por defecto) y `passwordHash` ya conectado. No estás obligado
a usarla —`withAuthFields()` combina los mismos campos del adaptador de autenticación con una
colección que escribas a mano—, pero es el camino más rápido y el que usa esta guía de principio a
fin.

## 3. Elegir los adaptadores y crear el runtime

Esta es la factoría de **desarrollo**: adaptadores en memoria, nada duradero. Es lo que quieres
mientras aprendes y en las pruebas. Una compilación de producción debe usar en su lugar una factoría
de perfil duradero (D1 + R2, o libSQL + S3) que lance un error ante una configuración incompleta;
consulta el [§9](#9-cloudflare-frente-a-portable) y [Deployment](/docs/deployment) (en inglés).

```ts
// server/runtime.ts
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';

export interface ServerEnv {
  DB?: D1Database;
  AUTH_SECRET?: string;
}

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  runtimePromise ??= buildRuntime(env);
  return runtimePromise;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  // DEVELOPMENT ONLY — never ship this selector: a missing binding silently becomes in-memory.
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  // Explicit dev mode (never inferred from a missing secret): `true` only under the dev server.
  const auth = new UsersCollectionAuthAdapter({ devMode: import.meta.dev === true }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    ...(env !== undefined && { env })
  });

  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
```

Constrúyelo de forma diferida, en la primera petición, y no al cargar el módulo: un Cloudflare Worker
prohíbe la E/S asíncrona en el ámbito del módulo, y esta estructura funciona exactamente igual fuera
de Cloudflare. En esta factoría de desarrollo, `env?.DB` elige D1 cuando existe el binding y la
memoria en caso contrario, y precisamente por eso **no** sirve para elegir en producción: un binding
ausente o mal nombrado perdería datos sin avisar. En producción se usa la factoría de perfil del
[§9](#9-cloudflare-frente-a-portable).

## 4. Montar la API de servidor

Cada ruta es un envoltorio fino: la lógica real vive en el manejador, no en el archivo de la ruta. En
Analog/h3:

```ts
// server/routes/api/auth/login.post.ts
import { defineEventHandler, toWebRequest } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  return handleLogin(
    { request: toWebRequest(event), env: event.context.cloudflare?.env },
    { runtime, cookie: { secure: !!event.context.cloudflare?.env } }
  );
});
```

Repite el mismo patrón de cuatro líneas para `signup.post.ts` (`handleSignup`, protegido tras tu
propio indicador `enabled`, desactivado por defecto), `logout.post.ts` (`handleLogout`) y `me.get.ts`
(`handleMe`). Después vienen las rutas CRUD genéricas de colecciones, con la misma forma y un archivo
por verbo: `GET`/`POST /api/v1/[collection]` (`handleList`/`handleCreate`) y
`GET`/`PUT`/`DELETE /api/v1/[collection]/[id]` (`handleRead`/`handleUpdate`/`handleDelete`).
Consulta [REST API](/docs/rest-api) (en inglés) para ver el contrato completo que producen.

## 5. Montar el panel de administración

```ts
// app/admin.routes.ts
import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
      }
    ]
  }
];
```

Ese es todo el panel: inicio de sesión y registro, un contenedor protegido, el índice reutilizable de
colecciones y el editor de documentos, y un espacio de usuarios reservado a los administradores. Sin
ninguna página CRUD escrita por la aplicación anfitriona. En `app.config.ts`, añade
`provideForgeCms({ baseUrl: '/api/v1' })`, sin `authToken`: la sesión del navegador es la cookie
HttpOnly `forge_session`, y `CmsApiService` la envía automáticamente.

¿Lo quieres en `/studio` en lugar de `/admin`, o tus APIs en otro sitio que no sea `/api/v1` y
`/api/auth`? Es configuración, no código: `basePath` en `forgeAdminAuthRoutes()` y en la
configuración del layout, `signInPath`/`forbiddenPath` en el guard, `baseUrl`/`authBaseUrl` en
`provideForgeCms()`; consulta
[Admin UI](/docs/admin-ui#mounting-somewhere-other-than-admin) (en inglés).

**Algo a tener en cuenta**: `@forge-cms/angular` y `@forge-cms/admin` incluyen código Ivy parcial,
que necesita el linker de Angular en el momento de compilar tu aplicación; de lo contrario te
encontrarás con un fallo `JIT compiler unavailable` que solo aparece en producción. Si usas Vite
(Analog.js), añade el plugin que ForgeCMS incluye exactamente para esto (`@forge-cms/admin/vite`
reexporta el mismo plugin):

```ts
// vite.config.ts
import { angularLinker } from '@forge-cms/angular/vite';

export default defineConfig({
  plugins: [angularLinker() /* your other plugins, e.g. analog() */]
});
```

## 6. Crear el primer administrador

No hay ningún script de semillas ni ningún endpoint de arranque aparte al que llamar: el primer
usuario que se crea en una instalación nueva siempre se promueve a `admin`, sea cual sea el rol que
indiques:

```ts
const admin = await auth.createUser({ email: 'you@example.com', password: 'a-real-password' });
// admin.user.role === 'admin', even though no role was requested
```

Una ruta que proteja esto tras la condición «todavía no existe ningún usuario» son unas pocas líneas
de tu propio código de servidor, no una nueva capacidad de Forge:

```ts
// server/routes/api/bootstrap-admin.post.ts
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  if ((await auth.listUsers()).length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already initialized' });
  }

  const body = await readBody(event);
  const created = await auth.createUser({ email: body.email, password: body.password });
  if (!created.ok) throw createError({ statusCode: 400, statusMessage: created.reason });
  return { data: { user: created.user } };
});
```

Pon un pequeño formulario delante (o simplemente llámala una vez con `curl`) y tendrás un flujo real
de primer arranque: cero filas, cero usuarios, una petición y un panel de administración que funciona.

## 7. Iniciar sesión

Visita `/admin/login`. Si todo va bien, el servidor establece la cookie `forge_session` y la sesión de
Angular (`ForgeAuthSession`, inyectada donde necesites `session.user()`/`session.authenticated()`) lo
refleja de inmediato, sin necesidad de recargar la página; además, la sesión sobrevive a una recarga
real porque es una cookie, no `localStorage`.

## 8. Gestionar el contenido

`/admin/collections` lista todas las colecciones registradas; `/admin/collections/posts` es un espacio
de trabajo completo —búsqueda, ordenación, filtro por estado, paginación, crear/editar/publicar/borrar—
generado a partir de la definición de `posts` del [§2](#2-definir-usuarios-y-entradas). El campo `author` se muestra como un
selector con búsqueda sobre `users`, no como una caja de texto donde pegar un id. Nada de esto es
código de la aplicación anfitriona.

## 9. Cloudflare frente a portable

Los dos perfiles duraderos ejecutan exactamente el mismo dominio del [§2](#2-definir-usuarios-y-entradas); solo cambian los
adaptadores de base de datos y de archivos. Producción selecciona **exactamente un perfil completo** y,
si no, se niega a arrancar (nunca recurre a la memoria). El `profile.ts` de `apps/tiny-project` es la
referencia probada; [Deployment](/docs/deployment) (en inglés) contiene las recetas ejecutables.

**Cloudflare — D1 + R2** (el camino mejor soportado):

```ts
import { D1DatabaseAdapter, R2StorageAdapter } from '@forge-cms/cloudflare';
if (!env.DB || !env.BUCKET)
  throw new Error('Incomplete Cloudflare profile: DB and BUCKET are required');
const database = new D1DatabaseAdapter(); // .init(env) happens inside runtime.init()
const storage = new R2StorageAdapter();
```

Configuración: un binding de D1 (`DB`) y otro de R2 (`BUCKET`) en `wrangler.toml`, y `AUTH_SECRET`
(al menos 32 bytes) en todas las compilaciones; solo el servidor de desarrollo, mediante un
`devMode: true` explícito, recurre al secreto público de desarrollo de Forge. Consulta
[Deployment](/docs/deployment) y
[Browser auth](/docs/browser-auth#production-configuration-and-abuse-limits) (en inglés).

**Portable — libSQL + S3** (sin cuenta de Cloudflare ni binding de ningún tipo):

```ts
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { S3StorageAdapter } from '@forge-cms/s3';
// DATABASE_URL=file:/data/forge.db (a persistent volume!) or a libsql:// URL; S3_BUCKET, S3_REGION, …
const database = new LibSqlDatabaseAdapter(process.env['DATABASE_URL']!);
const storage = new S3StorageAdapter({ bucket, region, endpoint, forcePathStyle, credentials });
```

`pnpm add @forge-cms/s3` lo añade. `@forge-cms/db` carga libSQL en la primera operación, así que
`init()` no abre la base de datos (una URL incorrecta hace fallar la primera llamada). El bucket de S3
debe existir de antemano.

El mismo `UsersCollectionAuthAdapter`, las mismas `collections`, el mismo runtime y el mismo panel de
administración. La sincronización del esquema, la creación del primer administrador, el inicio de
sesión, los usuarios, el CRUD de entradas, los borradores, la relación y las **subidas de archivos**
funcionan sin cambios.

### Subidas y archivos

Añade una colección con `upload: true` (consulta [Uploads](/docs/uploads), en inglés), monta
`POST /api/v1/[collection]` y la ruta de archivos `GET /api/media/[...key]` → `handleFile`. Ambos
perfiles almacenan los archivos de forma duradera (R2 o S3) y los sirven mediante `handleFile`, que
aplica las reglas de acceso del documento propietario. Mantén los buckets privados.

### Renderizado en el servidor y producción (S01–S03)

Las páginas públicas se renderizan en el servidor y se hidratan: establece `ssr: true` en `analog()`,
proporciona `provideForgeCmsServer({ origin })` en `main.server.ts`, lee el contenido público con un
cliente con `credentials: 'omit'` y `collectionResource(params, { transfer: 'public' })`, y compila con
el `angularLinker()` público de `@forge-cms/angular/vite`. La [guía de SSR](/docs/ssr) (en inglés)
tiene cada fragmento y las dos configuraciones de producción (Cloudflare Pages + D1 + R2;
`node-server` + libSQL + S3 con `nitro: { externals: { trace: false } }` y `node_modules` incluido
junto a `dist/`). El camino de esta guía —instalación → colecciones → factoría de perfil → manejadores
de autenticación → panel → primer administrador → SSR → cliente público → hidratación → subida →
compilación → servir → reiniciar → recuperar— se ejercita de extremo a extremo, solo a partir de
paquetes públicos empaquetados, con `pnpm test:s3 profiles` (Node compilado para producción + libSQL
en disco + Garage S3, y la salida de Cloudflare Pages bajo workerd local + D1 local + R2 local: es
evidencia con workerd local; el ensayo remoto aislado en Cloudflare se describe en
[Deployment](/docs/deployment)) y `pnpm release:ssr` (el consumidor técnico de SSR).

## Siguientes pasos

- [Inicio rápido](/es/docs/quickstart): la Local API mínima, sin autenticación ni panel.
- [Browser auth](/docs/browser-auth) (en inglés): el contrato de sesión con cookies, CSRF y registro
  en el que se apoya esta guía.
- [Admin UI](/docs/admin-ui) (en inglés): todos los componentes que exporta `@forge-cms/admin`.
- [Deployment](/docs/deployment) (en inglés): los dos perfiles duraderos al completo, además de la
  copia de seguridad y la recuperación.
