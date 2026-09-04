import type {
  CmsUser,
  CollectionDefinition,
  RelationFieldOptions,
  UploadFieldOptions
} from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { filterReadableFields } from './field-access.js';

interface RelationFieldEntry {
  name: string;
  targetSlug: string;
  many: boolean;
}

export interface PopulateOptions {
  user?: CmsUser | null;
  /**
   * Defaults to `true` (trusted Local API call, matching every other operation's default) — the
   * populated document is embedded as-is. `false` runs it through `filterReadableFields` against
   * *its own* collection's field-level `access.read` rules first, the same way the top-level
   * document already is. Without this, `depth: 1` on a `relation`/`upload` field embedded the
   * related document's raw row untouched — on a `defineUsersCollection()`/`withAuthFields()` target
   * this leaked `passwordHash` (`access.read: []`, meant to be unreadable by anyone) into any
   * anonymous or field-filtered response with a relation to `users`, e.g. `post.author -> users`
   * (found building spec 055's external-consumer fixture, whose content model is exactly that shape).
   */
  overrideAccess?: boolean;
}

/**
 * Every field `depth: 1` resolves: `relation` and — since spec 040 — `upload`, which is a single
 * relation to an upload-enabled collection in everything but name. Leaving `upload` out meant every
 * image in a populated response came back as a bare id, which no client can render.
 */
function getRelationFields(collection: CollectionDefinition): RelationFieldEntry[] {
  return Object.entries(collection.fields)
    .filter(([, field]) => field.kind === 'relation' || field.kind === 'upload')
    .map(([name, field]) => {
      if (field.kind === 'upload') {
        const options = field.options as UploadFieldOptions;
        return { name, targetSlug: options.collection, many: false };
      }
      const options = field.options as RelationFieldOptions;
      return { name, targetSlug: options.collection, many: options.many === true };
    });
}

export async function populateRecords(
  records: DatabaseRecord[],
  collection: CollectionDefinition,
  ctx: OperationContext,
  options: PopulateOptions = {}
): Promise<DatabaseRecord[]> {
  const relationFields = getRelationFields(collection);
  if (relationFields.length === 0 || records.length === 0) return records;

  const populated = records.map((record) => ({ ...record }));
  const user = options.user ?? null;
  const filterRelated = options.overrideAccess === false;

  for (const { name, targetSlug, many } of relationFields) {
    const targetCollection = ctx.getCollection(targetSlug);
    if (!targetCollection) continue;

    const ids = new Set<string>();
    for (const record of populated) {
      const value = record[name];
      if (many && Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === 'string') ids.add(id);
        }
      } else if (typeof value === 'string') {
        ids.add(value);
      }
    }
    if (ids.size === 0) continue;

    let related = await ctx.adapters.database.findMany({
      collection: targetSlug,
      where: { id: { in: Array.from(ids) } }
    });
    if (filterRelated) {
      related = await Promise.all(
        related.map((doc) => filterReadableFields(doc, targetCollection, user))
      );
    }
    const byId = new Map(related.map((r) => [r.id as string, r]));

    for (const record of populated) {
      const value = record[name];
      if (many && Array.isArray(value)) {
        record[name] = value
          .filter((id): id is string => typeof id === 'string')
          .map((id) => byId.get(id))
          .filter((related): related is DatabaseRecord => related !== undefined);
      } else if (typeof value === 'string') {
        record[name] = byId.get(value) ?? null;
      }
    }
  }

  return populated;
}

export async function populateRecord(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  ctx: OperationContext,
  options: PopulateOptions = {}
): Promise<DatabaseRecord> {
  const [result] = await populateRecords([record], collection, ctx, options);
  return result ?? record;
}
