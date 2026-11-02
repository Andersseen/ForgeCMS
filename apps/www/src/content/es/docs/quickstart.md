---
title: Inicio rápido
description: Instala ForgeCMS, define una colección y ejecuta operaciones CRUD mediante la Local API.
group: Getting started
order: 2
---

Este es el ForgeCMS más pequeño posible: la Local API con adaptadores en memoria, sin nada duradero.
Para un proyecto real, sigue el [Server quickstart](/docs/server-quickstart) verificado (libSQL,
primer administrador, control de acceso) o el [Angular/Analog quickstart](/docs/angular-quickstart)
(con el panel de administración incluido), ambos en inglés. Empieza desde tu propio repositorio:

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/db @forge-cms/auth @forge-cms/storage
```

Define una colección:

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    data: defineField.json()
  }
});
```

Crea el runtime:

```ts
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { notes } from './cms.js';

export const runtime = new ForgeCmsRuntime({
  collections: [notes],
  adapters: {
    database: new InMemoryDatabaseAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter()
  }
});

runtime.init();
await runtime.syncSchema();
```

Usa la Local API:

```ts
const created = await runtime.create({
  collection: 'notes',
  data: { title: 'Hello ForgeCMS', data: { source: 'docs' } }
});

const { docs } = await runtime.find({ collection: 'notes' });
const note = await runtime.findOne({ collection: 'notes', where: { title: 'Hello ForgeCMS' } });
await runtime.delete({ collection: 'notes', id: created.id });
```

`runtime.syncSchema()` crea las tablas que faltan y aplica los cambios aditivos seguros. Nunca
elimina, renombra, cambia el tipo ni rellena datos, y desde la versión `0.8.0` rechaza los cambios
que requerirían una migración de datos (esos los aplicas con una migración revisada); consulta
[Schema upgrades](/docs/schema-upgrades) (en inglés) para saber qué ocurre cuando cambias una
colección que ya tiene filas. Para integrarlo con el HTTP de tu framework, construye un `ApiContext`
y llama a los manejadores que exporta `@forge-cms/runtime`.

A continuación, monta el panel de administración y el cliente Angular: la
[Guía para un proyecto pequeño](/es/docs/small-project-guide) hace ambas cosas, con usuarios y
sesiones con cookies.

## Ejecutar la demo del repositorio

### Requisitos previos

- Node >= 22 (`.nvmrc`)
- pnpm 10.11.0 — nunca npm ni yarn: el workspace depende de cómo enlaza pnpm
- git

### 1. Clonar y compilar

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build   # required once: @forge-cms/* resolves to packages/*/dist
```

`pnpm build` no es opcional en un clon recién creado. El mapeo de rutas de TypeScript apunta
`@forge-cms/*` a `packages/*/dist/index.d.ts`, así que `pnpm typecheck` falla hasta que los paquetes
se han compilado una vez.

### 2. Ejecutar una aplicación

```sh
pnpm dev:www     # landing page + /admin + the CRUD API
pnpm dev:demo    # a full marketing site built on the CMS (apps/demo-aesthetics)
```

Abre la URL que aparece y ve a `/admin`. Las lecturas son públicas; crear, editar y borrar requiere
iniciar sesión:

| Aplicación                        | Correo electrónico       | Contraseña      | Rol    |
| --------------------------------- | ------------------------ | --------------- | ------ |
| `apps/www` (`/admin/login`)       | `demo@forgecms.dev`      | `forgecms-demo` | admin  |
| `apps/demo-aesthetics` (`/login`) | `demo@lumea.clinic`      | `lumea-demo`    | admin  |
| `apps/demo-aesthetics` (`/login`) | `frontdesk@lumea.clinic` | `lumea-desk`    | editor |

El desarrollo local usa adaptadores en memoria, así que **los datos se reinician con cada recarga**.
Es lo esperado; las aplicaciones desplegadas persisten en Cloudflare D1.

### 3. Añadir una colección

Todo vive en un único archivo: `apps/www/src/server/api/runtime.ts`. Las rutas HTTP y el panel de
administración no dependen de ninguna colección concreta: leen lo que esté registrado ahí, así que no
hay un segundo lugar donde conectar nada.

```ts
const testimonials = defineCollection({
  slug: 'testimonials',
  fields: {
    author: defineField.text({ required: true }),
    quote: defineField.textarea({ required: true }),
    rating: defineField.number({ min: 1, max: 5 }),
    featured: defineField.boolean({ defaultValue: false })
  }
});
```

Añádela al array `collections` del mismo archivo:

```ts
const collections = [pages, posts, products, media, users, categories, testimonials];
```

Guarda. El runtime se construye de forma diferida en cada petición, así que la siguiente petición lo
recoge: recarga `/admin/collections` y ahí está «testimonials», con un formulario funcional de
creación, edición y borrado generado a partir de esas definiciones de campos. No se ha tocado ningún
código del panel de administración.

### 4. Usarlo mediante HTTP

Las lecturas son abiertas. Las escrituras necesitan un token bearer:

```sh
# Log in
TOKEN=$(curl -s -X POST http://localhost:5173/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@forgecms.dev","password":"forgecms-demo"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.token))")

# Create
curl -X POST http://localhost:5173/api/v1/testimonials \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"author":"Ada","quote":"It just works.","rating":5,"featured":true}'

# List, filter, sort, paginate — no token needed
curl "http://localhost:5173/api/v1/testimonials?featured=true&sort=rating&order=desc&limit=10"
```

Si envías una petición sin `author`, obtienes un `400` con un error de validación por campo, porque
`@forge-cms/core` aplica `required: true` en cada escritura. Si la envías sin la cabecera
`Authorization`, obtienes un `401`.

### 5. Consultarlo desde el código de servidor

La API HTTP es para los clientes. Desde una ruta de servidor de Analog, sáltatela y llama
directamente a la [Local API](/docs/local-api) (en inglés):

```ts
// apps/www/src/server/routes/api/site/testimonials.get.ts
import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  const { docs } = await runtime.find({
    collection: 'testimonials',
    where: { featured: true },
    sort: 'rating',
    order: 'desc',
    limit: 3
  });

  return docs;
});
```

El mismo pipeline (validación, hooks, acceso, borradores) sin salto HTTP y sin tener que fabricar
ningún `Request`.

## 6. Consultarlo desde el navegador

```ts
import { Component, inject, signal } from '@angular/core';
import { CmsApiService } from '@forge-cms/angular';

@Component({ selector: 'app-testimonials', template: '…' })
export class TestimonialsComponent {
  private readonly cms = inject(CmsApiService);
  readonly testimonials = signal<Record<string, unknown>[]>([]);

  async ngOnInit() {
    const { docs } = await this.cms.listDocuments('testimonials', {
      where: { featured: true },
      sort: 'rating',
      order: 'desc',
      limit: 3
    });
    this.testimonials.set(docs);
  }
}
```

`provideForgeCms({ baseUrl: '/api/v1' })` ya está en `app.config.ts`. Consulta
[Angular client](/docs/angular-client) (en inglés) para ver la versión de lo mismo basada en signals,
con `collectionResource`.

## Siguientes pasos

- [Guía para un proyecto pequeño](/es/docs/small-project-guide): usuarios, autenticación con cookies
  y un panel de administración que funciona, de principio a fin.
- [Core concepts](/docs/concepts) (en inglés): qué son realmente el runtime, los adaptadores y la
  Local API.
- [Fields](/docs/fields) (en inglés): todos los tipos de campo y sus opciones.
- [Deployment](/docs/deployment) (en inglés): cómo desplegarlo en Cloudflare con D1 y R2.
