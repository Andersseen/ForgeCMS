/**
 * FINDING 9: `depth: 1` populates `relation` fields only — `populateRecords` filters on
 * `field.kind === 'relation'`, so an `upload` field (spec 016 calls it "structurally identical to a
 * single relation") comes back as a bare id and every image on the site would be a UUID.
 *
 * This is the app-side stand-in: one batched query per request, exactly what `populate.ts` would do.
 */
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import type { DatabaseRecord } from '@forge-cms/db';

export async function populateUploads<TEnv>(
  runtime: ForgeCmsRuntime<TEnv>,
  records: DatabaseRecord[],
  fields: string[]
): Promise<DatabaseRecord[]> {
  const ids = new Set<string>();
  for (const record of records) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) ids.add(value);
    }
  }
  if (ids.size === 0) return records;

  const media = await runtime.find({
    collection: 'media',
    where: { id: { in: Array.from(ids) } },
    limit: ids.size
  });
  const byId = new Map(media.docs.map((doc) => [String(doc.id), doc]));

  return records.map((record) => {
    const copy = { ...record };
    for (const field of fields) {
      const value = copy[field];
      if (typeof value === 'string') copy[field] = byId.get(value) ?? null;
    }
    return copy;
  });
}
