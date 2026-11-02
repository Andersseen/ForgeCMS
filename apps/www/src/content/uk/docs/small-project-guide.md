---
title: Посібник для невеликого проєкту
description: Додайте ForgeCMS до невеликого проєкту на Angular/Analog — користувачі, публікації, автентифікація через cookie та робоча адмін-панель — від початку до кінця.
group: Getting started
order: 4
---

У вас є невеликий проєкт на Angular/Analog. Вам потрібні користувачі, вхід, захищена адмін-панель і
кілька типів контенту. Ця сторінка — саме такий шлях від початку до кінця, і тут немає нічого
гіпотетичного: кожен фрагмент — це той самий код, який перевіряє `apps/tiny-project` у цьому
репозиторії (spec 055), навмисно крихітний споживач у стилі зовнішнього проєкту, побудований лише на
публічних експортах `@forge-cms/*`, наведених нижче.

## 1. Встановлення

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/auth @forge-cms/db @forge-cms/storage \
  @forge-cms/angular @forge-cms/admin
```

Додайте адаптери свого надійного профілю (див. [§9](#9-cloudflare-чи-портативний-профіль)):

```sh
pnpm add @forge-cms/cloudflare   # Cloudflare: D1 + R2
pnpm add @forge-cms/s3           # portable: libSQL (in @forge-cms/db) + S3
```

## 2. Визначення користувачів і публікацій

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

`defineUsersCollection()` — рекомендована форма колекції `users`: email, ім’я, поле вибору `role`
(`admin | editor | viewer`, за замовчуванням `viewer`) і вже підключене `passwordHash`. Використовувати
її не обов’язково — `withAuthFields()` додає ті самі поля адаптера автентифікації до колекції, яку ви
пишете вручну, — але це найшвидший шлях, і саме його цей посібник використовує всюди.

## 3. Вибір адаптерів і створення runtime

Це фабрика для **розробки**: адаптери in-memory, нічого не зберігається надійно. Саме вона потрібна
під час навчання й у тестах. Продакшен-збірка має натомість використовувати фабрику надійного профілю
(D1 + R2 або libSQL + S3), яка викидає помилку за неповної конфігурації, — див. [§9](#9-cloudflare-чи-портативний-профіль) і
[Deployment](/docs/deployment) (англійською).

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

Створюйте його ліниво, під час першого запиту, а не під час завантаження модуля: Cloudflare Worker
забороняє асинхронне введення-виведення на рівні модуля, а така структура так само працює й поза
Cloudflare. У цій фабриці для розробки `env?.DB` обирає D1, коли binding існує, і in-memory в іншому
разі — саме тому вона **не** придатна для вибору в продакшені: відсутній або неправильно названий
binding непомітно призвів би до втрати даних. У продакшені використовується фабрика профілю з
[§9](#9-cloudflare-чи-портативний-профіль).

## 4. Підключення серверного API

Кожен маршрут — це тонка обгортка: справжня логіка живе в обробнику, а не у файлі маршруту. В
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

Повторіть той самий чотирирядковий шаблон для `signup.post.ts` (`handleSignup`, захистіть його
власним прапорцем `enabled`, за замовчуванням вимкненим), `logout.post.ts` (`handleLogout`) і
`me.get.ts` (`handleMe`). Потім ідуть загальні CRUD-маршрути колекцій тієї самої форми, по одному файлу
на метод: `GET`/`POST /api/v1/[collection]` (`handleList`/`handleCreate`) і
`GET`/`PUT`/`DELETE /api/v1/[collection]/[id]` (`handleRead`/`handleUpdate`/`handleDelete`). Повний
контракт, який вони реалізують, див. у [REST API](/docs/rest-api) (англійською).

## 5. Підключення адмін-панелі

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

Це вся адмін-панель: вхід і реєстрація, захищена оболонка, багаторазовий перелік колекцій і
редактор документів, а також розділ користувачів, доступний лише адміністраторам. Жодної CRUD-
сторінки, написаної застосунком-хостом. В `app.config.ts` додайте
`provideForgeCms({ baseUrl: '/api/v1' })` — без `authToken`: сесія браузера — це HttpOnly-cookie
`forge_session`, і `CmsApiService` надсилає її автоматично.

Хочете розмістити її за адресою `/studio` замість `/admin` або мати API деінде, ніж `/api/v1` і
`/api/auth`? Це конфігурація, а не код: `basePath` у `forgeAdminAuthRoutes()` і в конфігурації
макета, `signInPath`/`forbiddenPath` у guard, `baseUrl`/`authBaseUrl` у `provideForgeCms()` — див.
[Admin UI](/docs/admin-ui#mounting-somewhere-other-than-admin) (англійською).

**На що варто зважати**: `@forge-cms/angular` і `@forge-cms/admin` постачають частково скомпільований
Ivy-код, якому потрібен лінкер Angular під час збірки вашого застосунку, інакше ви отримаєте збій
`JIT compiler unavailable`, що з’являється лише в продакшені. Якщо ви на Vite (Analog.js), додайте
плагін, який ForgeCMS постачає саме для цього (`@forge-cms/admin/vite` реекспортує той самий плагін):

```ts
// vite.config.ts
import { angularLinker } from '@forge-cms/angular/vite';

export default defineConfig({
  plugins: [angularLinker() /* your other plugins, e.g. analog() */]
});
```

## 6. Створення першого адміністратора

Немає ні seed-скрипту, ні окремого bootstrap-ендпоінту: найперший користувач, створений у свіжій
інсталяції, завжди отримує роль `admin`, незалежно від того, яку роль ви передали:

```ts
const admin = await auth.createUser({ email: 'you@example.com', password: 'a-real-password' });
// admin.user.role === 'admin', even though no role was requested
```

Маршрут, який захищає це умовою «жодного користувача ще немає», — це кілька рядків вашого власного
серверного коду, а не нова можливість Forge:

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

Додайте перед ним невелику форму (або просто викличте його один раз через `curl`) — і матимете
справжній сценарій першого запуску: нуль рядків, нуль користувачів, один запит і робоча адмін-панель.

## 7. Вхід

Перейдіть на `/admin/login`. Після успішного входу сервер встановлює cookie `forge_session`, і сесія
Angular (`ForgeAuthSession`, яку можна інжектувати всюди, де потрібні
`session.user()`/`session.authenticated()`) одразу це відображає — без перезавантаження сторінки, а
справжнє перезавантаження сесія переживає, бо це cookie, а не `localStorage`.

## 8. Керування контентом

`/admin/collections` показує всі зареєстровані колекції; `/admin/collections/posts` — це повноцінний
робочий простір із пошуком, сортуванням, фільтром за статусом, пагінацією, створенням, редагуванням,
публікацією й видаленням, згенерований із визначення `posts` у [§2](#2-визначення-користувачів-і-публікацій). Поле `author`
відображається як вибір із пошуком серед `users`, а не як текстове поле для вставлення id. Тут немає
жодного коду застосунку-хоста.

## 9. Cloudflare чи портативний профіль

Обидва надійні профілі виконують ту саму предметну модель із [§2](#2-визначення-користувачів-і-публікацій); змінюються лише адаптери
бази даних і файлів. Продакшен обирає **рівно один повний профіль** і в іншому разі відмовляється
запускатися (жодного запасного варіанта in-memory). `profile.ts` в `apps/tiny-project` — перевірений
еталон; [Deployment](/docs/deployment) (англійською) містить робочі рецепти.

**Cloudflare — D1 + R2** (найкраще підтримуваний шлях):

```ts
import { D1DatabaseAdapter, R2StorageAdapter } from '@forge-cms/cloudflare';
if (!env.DB || !env.BUCKET)
  throw new Error('Incomplete Cloudflare profile: DB and BUCKET are required');
const database = new D1DatabaseAdapter(); // .init(env) happens inside runtime.init()
const storage = new R2StorageAdapter();
```

Конфігурація: binding D1 (`DB`) і binding R2 (`BUCKET`) у `wrangler.toml`, а також `AUTH_SECRET`
(щонайменше 32 байти) у кожній збірці; лише сервер розробки через явне `devMode: true` використовує
публічний секрет розробки Forge. Див. [Deployment](/docs/deployment) і
[Browser auth](/docs/browser-auth#production-configuration-and-abuse-limits) (англійською).

**Портативний — libSQL + S3** (без облікового запису Cloudflare і без будь-яких binding):

```ts
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { S3StorageAdapter } from '@forge-cms/s3';
// DATABASE_URL=file:/data/forge.db (a persistent volume!) or a libsql:// URL; S3_BUCKET, S3_REGION, …
const database = new LibSqlDatabaseAdapter(process.env['DATABASE_URL']!);
const storage = new S3StorageAdapter({ bucket, region, endpoint, forcePathStyle, credentials });
```

Його додає `pnpm add @forge-cms/s3`. `@forge-cms/db` завантажує libSQL під час першої операції, тому
`init()` не відкриває базу даних (неправильна URL-адреса призводить до помилки першого виклику). S3-
бакет має існувати заздалегідь.

Той самий `UsersCollectionAuthAdapter`, ті самі `collections`, той самий runtime, та сама адмін-
панель. Синхронізація схеми, створення першого адміністратора, вхід, користувачі, CRUD публікацій,
чернетки, зв’язок і **завантаження файлів** працюють без змін.

### Завантаження та файли

Додайте колекцію з `upload: true` (див. [Uploads](/docs/uploads), англійською), підключіть
`POST /api/v1/[collection]` і файловий маршрут `GET /api/media/[...key]` → `handleFile`. Обидва
профілі зберігають файли надійно (R2 або S3) і віддають їх через `handleFile`, який застосовує
правила доступу документа-власника. Тримайте бакети приватними.

### Рендеринг на сервері та продакшен (S01–S03)

Публічні сторінки рендеряться на сервері й гідратуються: встановіть `ssr: true` в `analog()`, надайте
`provideForgeCmsServer({ origin })` у `main.server.ts`, читайте публічний контент клієнтом із
`credentials: 'omit'` і `collectionResource(params, { transfer: 'public' })` та збирайте з публічним
`angularLinker()` з `@forge-cms/angular/vite`. [Посібник з SSR](/docs/ssr) (англійською) містить усі
фрагменти та дві продакшен-конфігурації (Cloudflare Pages + D1 + R2; `node-server` + libSQL + S3 з
`nitro: { externals: { trace: false } }` і `node_modules`, що постачаються поруч із `dist/`). Шлях
цього посібника — встановлення → колекції → фабрика профілю → обробники автентифікації → адмін-панель
→ перший адміністратор → SSR → публічний клієнт → гідратація → завантаження → збірка → запуск →
перезапуск → відновлення — перевіряється наскрізно, лише із запакованих публічних пакетів, командою
`pnpm test:s3 profiles` (продакшен-збірка Node + libSQL на диску + Garage S3, а також вихідні файли
Cloudflare Pages під локальним workerd + локальні D1 і R2 — це свідчення з локального workerd;
ізольоване віддалене відпрацювання на Cloudflare описано в [Deployment](/docs/deployment)) і
`pnpm release:ssr` (технічний SSR-споживач).

## Далі

- [Швидкий старт](/uk/docs/quickstart) — мінімальний Local API без автентифікації й адмін-панелі.
- [Browser auth](/docs/browser-auth) (англійською) — контракт cookie-сесії, CSRF і реєстрації, на
  якому побудовано цей посібник.
- [Admin UI](/docs/admin-ui) (англійською) — усі компоненти, які експортує `@forge-cms/admin`.
- [Deployment](/docs/deployment) (англійською) — обидва надійні профілі повністю, а також резервне
  копіювання й відновлення.
