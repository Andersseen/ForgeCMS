---
name: forgecms-localization
description: Make ForgeCMS content editable in several languages (for example Spanish and English) using exactly the supported localization contract, including what is NOT supported.
---

# ForgeCMS localization

## The supported contract

1. The **collection or global declares `locales`**.
2. Mark **top-level `text` and `textarea`** fields `localized: true`.
3. The admin renders locale controls for those fields. Editing ES does not overwrite EN: a write with a `locale` changes only that locale.
4. **Without `locale`**, a read returns the whole map: `{ es: 'Tratamientos', en: 'Treatments' }`.
5. **With `locale`** (Local API option, or `?locale=` over HTTP), a read returns the resolved scalar. Fallback: the exact locale, then its language, then the first declared locale.

```ts
export const services = defineCollection({
  slug: 'services',
  locales: ['es', 'en'],
  fields: {
    title: defineField.text({ required: true, localized: true }),
    description: defineField.textarea({ localized: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }), // shared
    image: defineField.upload({ collection: 'media' }) // shared
  }
});

await runtime.update({ collection: 'services', id, data: { title: 'Tratamientos' }, locale: 'es' });
await runtime.find({ collection: 'services', locale: 'en', overrideAccess: false, user: null }); // public read: only published documents
```

Globals follow the same contract through `runtime.getGlobalDocument({ global, locale })` and `runtime.updateGlobalDocument({ global, data, locale })`. Two simultaneous per-locale edits of a global cannot silently drop one: the later gets `409`. A global write **without** `locale` that sends the whole map replaces it (last writer wins).

## Refused at startup (do not generate these)

- a localized field without `locales`;
- a localized field of any kind other than `text`/`textarea` (no localized `richtext`, `json`, `number`, `select`...);
- a localized field nested in `group`/`array`/`blocks`;
- a localized `relation` or `upload`.

Filtering or sorting on a localized field is **not supported** (the map is stored as JSON).

## Practical patterns

- **Shared images, localized copy:** keep the `upload` field non-localized; add localized `text` fields next to it for alt/caption (`imageAlt`, `imageCaption`).
- **Site settings:** a global with `locales` and localized `siteName`, `tagline`, footer text.
- **Navigation labels:** a global with a non-localized `array` of `{ href }` rows cannot hold localized labels (no localization inside arrays). Model each menu entry as its own small collection with localized `label` and a shared `href`/`order`, or keep fixed labels as top-level localized fields.
- **SEO text:** top-level localized `seoTitle` (`text`) and `seoDescription` (`textarea`).
- **Slugs:** keep one shared slug unless you accept that it must be derived from a single locale.
- **Long structured copy per language:** use separate collection documents per language only if the localized-text fields are not enough; do not invent localized richtext.

Richer localization (localized richtext/blocks/arrays, translation workflows) does not exist yet. Say so instead of improvising.
