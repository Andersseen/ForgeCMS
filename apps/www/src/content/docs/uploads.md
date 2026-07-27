---
title: Uploads & media
description: Upload-enabled collections, the multipart flow, serving files, and upload fields.
group: Content modelling
order: 5
---

## 1. Mark a collection as upload-enabled

```ts
const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text()
  }
});
```

`upload: true` makes one thing true: `POST /api/v1/media` also accepts `multipart/form-data`. The
JSON path is unchanged, and every other collection is unaffected.

## 2. Post a file

```sh
curl -X POST http://localhost:5173/api/v1/media \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@./hero.jpg' \
  -F 'alt=Treatment room'
```

The part **must be named `file`** — anything else is a `400`. What happens next:

1. the bytes are stored through the `StorageAdapter` under `<collection>/<uuid>-<filename>`;
2. `getPublicUrl(key)` produces the URL;
3. a normal document is created, carrying whichever of `filename`, `url`, `contentType` and
   `filesize` your collection actually declares — fields you did not declare are dropped rather than
   inserted against a column that does not exist;
4. any other string form field that matches a declared field (`alt` above) is written too.

So the media document is not special: it is validated, hooked, access-checked and listed like
anything else.

## 3. Serve the bytes

Storing a file does not make it reachable. Mount `handleFile` on the path your storage adapter's
public URL points at:

```ts
// apps/<app>/src/server/routes/api/media/[...key].get.ts
import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import { handleFile } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  return handleFile(
    { request: toWebRequest(event), params: { key: getRouterParam(event, 'key') ?? '' } },
    { runtime }
  );
});
```

Without this, every uploaded image on a deployment with a private bucket or the in-memory adapter is
a broken link. `handleFile` takes an optional `cacheControl` and returns `404` for a missing key.

If your bucket **is** public (an R2 custom domain, a CDN), point the adapter at it instead and skip
the route:

```ts
new R2StorageAdapter({ publicUrlBase: 'https://cdn.example.com' });
```

## 4. Reference the file from other collections

```ts
const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    cover: defineField.upload({ collection: 'media' })
  }
});
```

The stored value is the media document's id. Ask for `depth: 1` and it comes back populated:

```ts
const { docs } = await runtime.find({ collection: 'posts', depth: 1 });
// docs[0].cover → { id, filename, url, contentType, filesize, alt, … }
```

```sh
curl "http://localhost:5173/api/v1/posts?depth=1"
```

The admin renders an `upload` field as a picker with a preview, an upload button and the existing
media library.

## From the Angular client

```ts
// `fields` are extra string form fields; the content type is left to the browser so it can set
// the multipart boundary itself.
const doc = await cms.uploadFile('media', file, { alt: 'Treatment room' });
```

## What is missing

Know these before building on it:

- **Deleting a document does not delete its stored object.** The bytes stay in the bucket. A
  `beforeDelete`/`afterDelete` hook can do it in userland, but nothing is built in.
- **No image resizing, thumbnails or variants.** What you upload is what you serve.
- **No presigned/direct-to-storage uploads** — bytes go through your server, which matters for large
  files on a Worker.
- **No referential integrity.** Deleting a media document leaves `upload` fields pointing at a dead
  id.
