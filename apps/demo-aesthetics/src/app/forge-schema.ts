import type { ForgeDocument, ForgeSchema } from '@forge-cms/angular';
// Types only (spec 076): `import type` is erased, so none of the server's hooks, access rules, guards
// or auth configuration reaches the browser bundle — only the shape of the content model does.
import type { DemoCollections } from '../server/api/collections';

/** The clinic's content model as the browser sees it: `injectForgeClient<DemoSchema>()`. */
export type DemoSchema = ForgeSchema<DemoCollections>;

/** One document of a collection exactly as the HTTP API returns it. */
export type DemoDocument<TSlug extends DemoCollections[number]['slug']> = ForgeDocument<
  DemoSchema,
  TSlug
>;
