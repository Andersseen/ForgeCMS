---
title: Швидкий старт
description: Встановіть ForgeCMS, визначте колекцію та виконайте CRUD-операції через Local API.
group: Getting started
order: 2
---

Це найменша можлива ForgeCMS: Local API з адаптерами in-memory, без жодного надійного сховища. Для
реального проєкту скористайтеся перевіреним [Server quickstart](/docs/server-quickstart) (libSQL,
перший адміністратор, контроль доступу) або [Angular/Analog quickstart](/docs/angular-quickstart)
(з адмін-панеллю), обидва англійською. Почніть із власного репозиторію:

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/db @forge-cms/auth @forge-cms/storage
```

Визначте колекцію:

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

Створіть runtime:

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

Використовуйте Local API:

```ts
const created = await runtime.create({
  collection: 'notes',
  data: { title: 'Hello ForgeCMS', data: { source: 'docs' } }
});

const { docs } = await runtime.find({ collection: 'notes' });
const note = await runtime.findOne({ collection: 'notes', where: { title: 'Hello ForgeCMS' } });
await runtime.delete({ collection: 'notes', id: created.id });
```

`runtime.syncSchema()` створює відсутні таблиці та застосовує безпечні адитивні зміни. Він ніколи не
видаляє, не перейменовує, не змінює тип і не заповнює дані заднім числом, а починаючи з `0.8.0`
відхиляє зміни, які потребували б міграції даних (їх ви застосовуєте перевіреною міграцією); що
відбувається, коли ви змінюєте колекцію, у якій уже є рядки, див. у
[Schema upgrades](/docs/schema-upgrades) (англійською). Для інтеграції з HTTP вашого фреймворку
створіть `ApiContext` і викликайте обробники, які експортує `@forge-cms/runtime`.

Далі змонтуйте адмін-панель і Angular-клієнт: [Посібник для невеликого
проєкту](/uk/docs/small-project-guide) робить і те, й інше — з користувачами та сесіями на cookie.

## Запуск демо з репозиторію

### Передумови

- Node >= 22 (`.nvmrc`)
- pnpm 10.11.0 — ніколи npm чи yarn: робочий простір залежить від того, як pnpm зв’язує пакети
- git

### 1. Клонування та збірка

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build   # required once: @forge-cms/* resolves to packages/*/dist
```

`pnpm build` не є необов’язковим для щойно клонованого репозиторію. Зіставлення шляхів TypeScript
спрямовує `@forge-cms/*` на `packages/*/dist/index.d.ts`, тож `pnpm typecheck` завершується
помилкою, доки пакети не буде зібрано хоча б раз.

### 2. Запуск застосунку

```sh
pnpm dev:www     # landing page + /admin + the CRUD API
pnpm dev:demo    # a full marketing site built on the CMS (apps/demo-aesthetics)
```

Відкрийте виведену URL-адресу й перейдіть до `/admin`. Читання публічне; створення, редагування й
видалення потребують входу:

| Застосунок                        | Email                    | Пароль          | Роль   |
| --------------------------------- | ------------------------ | --------------- | ------ |
| `apps/www` (`/admin/login`)       | `demo@forgecms.dev`      | `forgecms-demo` | admin  |
| `apps/demo-aesthetics` (`/login`) | `demo@lumea.clinic`      | `lumea-demo`    | admin  |
| `apps/demo-aesthetics` (`/login`) | `frontdesk@lumea.clinic` | `lumea-desk`    | editor |

Локальна розробка використовує адаптери in-memory, тому **дані скидаються після кожного
перезавантаження**. Так і має бути; розгорнуті застосунки зберігають дані в Cloudflare D1.

### 3. Додавання колекції

Усе зосереджено в одному файлі — `apps/www/src/server/api/runtime.ts`. HTTP-маршрути й адмін-панель
не прив’язані до конкретних колекцій: вони читають усе, що там зареєстровано, тож немає другого
місця, де треба щось підключати.

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

Додайте її до масиву `collections` у тому самому файлі:

```ts
const collections = [pages, posts, products, media, users, categories, testimonials];
```

Збережіть. Runtime створюється ліниво для кожного запиту, тож наступний запит підхопить зміну:
перезавантажте `/admin/collections` — і там з’явиться «testimonials» з робочою формою створення,
редагування й видалення, згенерованою з цих визначень полів. Код адмін-панелі не змінювався.

### 4. Робота через HTTP

Читання відкрите. Для запису потрібен bearer-токен:

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

Надішліть запит без `author` — і отримаєте `400` з помилкою валідації для конкретного поля, бо
`@forge-cms/core` перевіряє `required: true` під час кожного запису. Надішліть без заголовка
`Authorization` — і отримаєте `401`.

### 5. Запити із серверного коду

HTTP API призначений для клієнтів. У серверному маршруті Analog обійдіть його й викликайте
[Local API](/docs/local-api) (англійською) безпосередньо:

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

Той самий конвеєр — валідація, хуки, доступ, чернетки — без HTTP-запиту й без потреби вигадувати
`Request`.

## 6. Запити з браузера

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

`provideForgeCms({ baseUrl: '/api/v1' })` уже є в `app.config.ts`. Версію того самого на основі
сигналів із `collectionResource` див. в [Angular client](/docs/angular-client) (англійською).

## Далі

- [Посібник для невеликого проєкту](/uk/docs/small-project-guide) — користувачі, автентифікація
  через cookie та робоча адмін-панель від початку до кінця.
- [Core concepts](/docs/concepts) (англійською) — чим насправді є runtime, адаптери та Local API.
- [Fields](/docs/fields) (англійською) — усі типи полів та їхні параметри.
- [Deployment](/docs/deployment) (англійською) — розгортання в Cloudflare з D1 і R2.
