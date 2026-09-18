import type {
  CmsUser,
  CollectionDefinition,
  RelationFieldOptions,
  UploadFieldOptions
} from '@forge-cms/core';
import type { DatabaseRecord, DatabaseWhere } from '@forge-cms/db';
import type { OperationContext } from './context.js';
import { filterReadableFields } from './field-access.js';
import { mergeWhere } from './access.js';
import { checkAccess, statusConstraint } from './read-policy.js';
import { AccessDeniedError } from './errors.js';

interface RelationFieldEntry {
  name: string;
  targetSlug: string;
  many: boolean;
}

export interface PopulateOptions {
  user?: CmsUser | null;
  /**
   * Defaults to `true` (trusted Local API call, matching every other operation's default) — the
   * populated document is embedded as-is. `false` enforces the target collection's own read policy
   * — collection-level access, row-level predicates, and draft visibility (spec 058 §4) — before the
   * document is even fetched, then projects it through `filterReadableFields` against its field-level
   * `access.read` rules, the same way the top-level document already is. Without the field-level half
   * of this, `depth: 1` on a `relation`/`upload` field embedded the related document's raw row
   * untouched — on a `defineUsersCollection()`/`withAuthFields()` target this leaked `passwordHash`
   * (`access.read: []`, meant to be unreadable by anyone) into any anonymous or field-filtered
   * response with a relation to `users`, e.g. `post.author -> users` (found building spec 055's
   * external-consumer fixture). Field-level projection alone was not enough, though: a readable
   * parent document does not make an unrelated *target* document readable — a public `post` could be
   * readable while its related `author` (or a draft target) stayed private, and depth-1 population
   * would still embed it in full. §4 closes that: a caller cannot see more of a populated target
   * through population than they could by reading that target directly.
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

    let related: DatabaseRecord[] = [];
    if (filterRelated) {
      // A readable parent must not automatically grant visibility into the target collection: apply
      // its own collection/row/draft read policy to the query itself, so an inaccessible or hidden
      // target is never fetched in the first place (spec 058 §4) — not merely field-projected after
      // the fact. A collection-level denial (`AccessDeniedError`) means every target of this field is
      // hidden; `related` stays `[]` and every id in it resolves the same way a dangling/missing id
      // already does (single → null, many → omitted) — inaccessible and missing are indistinguishable.
      try {
        const decision = await checkAccess(targetCollection, 'read', {
          user,
          overrideAccess: false
        });
        const idFilter: DatabaseWhere = { id: { in: Array.from(ids) } };
        const where =
          mergeWhere(
            mergeWhere(idFilter, decision.where),
            statusConstraint(targetCollection, undefined, user, false, 'all')
          ) ?? idFilter;

        related = await ctx.adapters.database.findMany({ collection: targetSlug, where });
        related = await Promise.all(
          related.map((doc) => filterReadableFields(doc, targetCollection, user))
        );
      } catch (err) {
        if (!(err instanceof AccessDeniedError)) throw err;
      }
    } else {
      related = await ctx.adapters.database.findMany({
        collection: targetSlug,
        where: { id: { in: Array.from(ids) } }
      });
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
