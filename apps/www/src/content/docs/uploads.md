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

1. the bytes are stored through the `StorageAdapter` under `<collection>/<uuid>-<filename>`, and
   that key is recorded on the document as `_storageKey`. Only this pipeline can set it: no JSON
   body, form field, hook or Local API call can choose or change it;
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
a broken link.

**`handleFile` applies your collection's read access.** It serves a key only as the file of the
upload document that owns it, meaning the document whose `_storageKey` is that key:

- **Who can read.** The caller (resolved from the session cookie or token, like any API request)
  must be able to read that document: collection and row access, and draft visibility.
- **Not found.** A key no document owns, or one whose document the caller cannot read, is the same
  `404`.
- **Caching.** Anonymous hits get `cacheControl` (default `public, max-age=60`). Authenticated hits
  are always `private, no-store`, so a shared cache never hands one user's file to another.
- **Older uploads.** Uploads recorded before `_storageKey` existed have no owner and return `404`
  here. Backfill their `_storageKey` (the part of `url` after your media route) to serve them again.

If your bucket **is** public (an R2 custom domain, a CDN), point the adapter at it instead and skip
the route:

```ts
new R2StorageAdapter({ publicUrlBase: 'https://cdn.example.com' });
```

## Portable files: libSQL + S3

Off Cloudflare, the same pipeline runs on an on-disk libSQL database and an S3-compatible bucket
(`@forge-cms/s3`, server-side only). Nothing else changes: the same multipart `handleCreate`, the same
`handleFile` route, the same storage intents and `reconcileStorage()`.

```ts
import { S3StorageAdapter } from '@forge-cms/s3';

const storage = new S3StorageAdapter({
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT, // omit for AWS S3
  forcePathStyle: true // most S3-compatible services
  // credentials: omit to use the AWS SDK's provider chain
});
```

Keep the default public URL base (`/api/media`) so every read passes through `handleFile`'s access check.
This combination is proven end to end against a real Garage service: upload, anonymous and protected
reads, restart persistence, delete, and recovery of a failed object delete or a failed database commit
through `reconcileStorage()`. A missing object is a `404`; an unreachable bucket or rejected credentials
are a generic `500` that names no bucket, endpoint or key. There is still no transaction across the
database and the bucket. Only Garage is certified; AWS S3, Backblaze B2 and Wasabi are configuration
examples. Deployment and backup/restore guides are still to come (roadmap 0.10 / P03).

## When storage and the database disagree

A database transaction cannot include your bucket. So Forge writes a **storage intent** row, in the
database, whenever an object could end up owned by no document:

- **Upload.** The intent is written before the object is stored, and removed in the same batch that
  creates the document.
- **Delete.** The intent is written in the same batch that deletes the document, and removed once the
  object is gone.

A crash, or a failed cleanup at either step, leaves the intent behind instead of an unrecorded
orphan. Work them off with:

```ts
const report = await runtime.reconcileStorage(); // { deleted, kept, pending, failed }
```

- **Where to run it.** From a scheduled job (a Cloudflare Cron Trigger) or an operator script. It is
  safe to run repeatedly and from several places at once.
- **Grace period.** Upload intents younger than `uploadGraceMs` (default one hour) are left alone,
  because their upload may still be committing.
- **What it never does.** It never deletes an object a document owns. A failed delete keeps its
  intent for the next run.
- **Residual.** A process that dies in the middle of reconciliation can leak that one object; it
  cannot break a document.

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

- **Deleting a document deletes exactly the object in its `_storageKey`**, after the database
  delete succeeds. If that fails, a storage intent records it for `reconcileStorage()`. A document without one (created from JSON, or recorded before storage keys existed)
  deletes no object, and Forge logs a warning. Before spec 063, Forge guessed the key from `url`.
  `url` is an editable field, so that guess could point at somebody else's file, and it was removed.
  Clean up objects from such older records by hand.
- **No Local API upload.** Server code that must attach an object already in storage writes the row
  through `runtime.adapters.database` (the raw layer, outside every CMS check).
- **No image resizing, thumbnails or variants.** What you upload is what you serve.
- **No presigned/direct-to-storage uploads** — bytes go through your server, which matters for large
  files on a Worker.
- **Upload references restrict.** Deleting a media document that an `upload` field still references
  is refused (spec 064).
