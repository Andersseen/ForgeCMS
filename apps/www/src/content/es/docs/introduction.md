---
title: Introducción
description: Qué es ForgeCMS, qué hace ya y qué todavía no hace.
group: Getting started
order: 1
---

ForgeCMS es una **base de CMS code-first y nativa de TypeScript** con soporte de primera clase para
Angular, Analog.js y Cloudflare.

Describes tu contenido en TypeScript:

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    body: defineField.richtext(),
    cover: defineField.upload({ collection: 'media' }),
    author: defineField.relation({ collection: 'users' })
  }
});
```

…y esa única definición controla el esquema de la base de datos, la validación en tiempo de
ejecución, la API REST, el formulario del panel de administración y los tipos que recibes en tu
aplicación Angular. No hay ningún archivo de esquema que mantener sincronizado ni ningún paso de
generación de código.

## Por qué existe

Todos los CMS headless serios de este espacio dan por hecho React. Payload, Strapi y Sanity incluyen
paneles de administración en React y bibliotecas cliente pensadas para React; usarlos desde Angular
supone ejecutar el framework de otro junto al tuyo, o escribir a mano un cliente para una API REST que
no diseñaste.

ForgeCMS parte del extremo opuesto: signals de Angular, rutas de servidor de Analog.js, un panel de
administración formado por componentes Angular que puedes importar y una **Local API que llamas
directamente desde el código de servidor**, sin ningún salto HTTP entre tu ruta de Analog y tu
contenido.

## Qué funciona hoy

- **DSL de esquemas y validación**: 15 tipos de campo, incluidos `group`, `array` y `blocks` (la
  primitiva para construir páginas), validados en tiempo de ejecución en cada escritura.
- **Una Local API tipada**: `find`, `findOne`, `findByID`, `create`, `update`, `delete` y `count`
  sobre el objeto runtime, que ejecutan el pipeline completo (control de acceso, hooks, borradores,
  población de relaciones y validación) e infieren los documentos a partir de las definiciones de tus
  colecciones.
- **Una API REST**: CRUD con filtros (incluidos `and`/`or` anidados), ordenación por varios campos,
  paginación, población de relaciones y visibilidad de borradores, con un envoltorio de respuesta
  estable.
- **Control de acceso mediante funciones**: una regla puede devolver `true`/`false` o una **consulta**
  que restringe qué documentos puede tocar la operación (reglas por fila como «los autores solo editan
  sus propias entradas»).
- **Un pipeline de hooks completo**: nueve etapas de colección más hooks por campo.
- **Autenticación real**: usuarios almacenados en tu base de datos con hash PBKDF2, sesiones con
  cookies y protección CSRF, claves de API con ámbito y roles admin/editor/viewer.
- **Ciclo de vida del contenido**: borradores, versiones de documentos con restauración, vista previa
  en vivo, globals, localización y reglas de integridad de relaciones al borrar.
- **Subidas**: creación con `multipart/form-data` a través de un `StorageAdapter`, con un manejador
  para servir archivos.
- **Adaptadores**: en memoria, LibSQL/Turso y Cloudflare D1 para la base de datos; en memoria y R2
  para el almacenamiento; todos sujetos a un conjunto común de pruebas de contrato.
- **Un cliente Angular y un panel de administración**: `CmsApiService` más recursos basados en
  signals, una sesión con cookies y un guard de ruta, y un panel que montas bajo tus propias rutas
  (contenido, usuarios, inicio de sesión).

## Qué es experimental

Sé honesto contigo mismo sobre esta lista antes de adoptarlo para algo importante:

- **1.0 estable.** La familia fija de doce paquetes está publicada en `1.0.0`. La versión aceptada
  `1.0.0-rc.2` sigue formando parte del historial de versiones. Instala los paquetes estables con
  versiones coincidentes; el Agent Kit experimental y Cloudflare Analytics quedan fuera de la promesa
  de compatibilidad 1.x. Consulta
  [Support and compatibility](https://github.com/Andersseen/ForgeCMS/blob/main/docs/SUPPORT.md) (en
  inglés).
- **Las actualizaciones del esquema son explícitas.** La sincronización del esquema aplica los cambios
  aditivos seguros y rechaza las divergencias que requieren una migración de datos. Las migraciones
  revisadas aplican esos cambios desde tu script de despliegue, exactamente una vez. No hay
  migraciones hacia atrás. Las actualizaciones desde versiones anteriores y la copia de seguridad y
  restauración se ensayan en CI sobre libSQL y D1/R2 locales, y la copia de seguridad y la
  restauración aislada del perfil de Cloudflare se ensayaron en un entorno de staging real y aislado
  de Cloudflare. Consulta [Schema upgrades](/docs/schema-upgrades) (en inglés).
- **La población de relaciones tiene un solo nivel de profundidad** (`depth: 1`), y no se puede
  consultar dentro de los valores JSON compuestos.
- **El SSR usa un origen de servidor explícito.** Las páginas públicas se renderizan e hidratan con
  `provideForgeCmsServer` y un cliente con `credentials: 'omit'` (consulta [SSR](/docs/ssr), en
  inglés); las rutas de servidor pueden seguir llamando directamente a la Local API.
- **El almacenamiento duradero es R2 o S3.** `@forge-cms/s3` cubre los servicios compatibles con S3
  (Garage está certificado en CI; AWS S3, B2 y Wasabi son configurables, no certificados). El
  almacenamiento en memoria es solo para desarrollo.
- **No hay adaptador de correo electrónico, sistema de plugins ni CLI.**

## Cómo encajan las piezas

```txt
Your Angular app  ──►  @forge-cms/angular  ──►  HTTP /api/v1/*  ──┐
                                                                  ├─►  @forge-cms/runtime  ──►  adapters (db / auth / storage)
Your server route ──►  runtime.find(...)  (Local API, no HTTP)  ──┘
```

`@forge-cms/core` define el esquema, `@forge-cms/runtime` ejecuta las operaciones y los paquetes de
adaptadores se comunican con el exterior. Lee [Core concepts](/docs/concepts) (en inglés) para ver el
panorama completo.

## Adónde ir después

- [Hoja de ruta de ForgeCMS 2.0](/docs/roadmap) (en inglés): la dirección del producto más allá de la
  base 1.0 ya publicada.

- [Server quickstart](/docs/server-quickstart) y [Angular/Analog quickstart](/docs/angular-quickstart)
  (en inglés): los dos caminos de inicio verificados.
- [Guía para un proyecto pequeño](/es/docs/small-project-guide): usuarios, autenticación con cookies,
  entradas y un panel de administración que funciona.
- [Inicio rápido](/es/docs/quickstart): el camino mínimo con la Local API y adaptadores en memoria.
- [Troubleshooting](/docs/troubleshooting) y las
  [limitaciones intencionadas](https://github.com/Andersseen/ForgeCMS/blob/main/docs/LIMITATIONS.md)
  (en inglés).
- [Core concepts](/docs/concepts) (en inglés): el modelo mental, en una sola página.
- [Collections](/docs/collections) y [Fields](/docs/fields) (en inglés): la referencia de modelado.
- [Local API](/docs/local-api) (en inglés): la forma de usar ForgeCMS desde el código de servidor.
- [Schema upgrades](/docs/schema-upgrades) (en inglés): qué ocurre cuando cambias una colección.

El repositorio también mantiene un registro pensado para quien lo mantiene: `docs/STATE.md` (qué está
implementado, paquete por paquete), `docs/ARCHITECTURE.md` y `docs/specs/` (una especificación por
funcionalidad, con el razonamiento que la respalda).
