---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
---

feat: add Localization support (i18n)

- Add `localized: true` option to BaseFieldOptions for i18n fields
- Add `locales` option to CollectionDefinition for supported locales
- Localized fields store values as objects: `{ en: "Hello", es: "Hola" }`
- Add locale resolution with fallback chain (exact -> language -> default)
- Add `locale` parameter to Local API operations (create, update, find, findByID)
- Localized fields are resolved to requested locale on read
- Localized fields are stored per-locale on write
- Add localization utilities: resolveLocale, getLocalizedValue, setLocalizedValue
- Add validation support for localized fields (accepts objects with locale keys)
- Add 19 tests covering localization functionality
