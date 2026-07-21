import type { CollectionDefinition, RelationFieldOptions } from '@forge-cms/core';
import type { DatabaseRecord } from '@forge-cms/db';
import type { ForgeCmsRuntime } from './runtime.js';

interface RelationFieldEntry {
  name: string;
  targetSlug: string;
  many: boolean;
}

function getRelationFields(collection: CollectionDefinition): RelationFieldEntry[] {
  return Object.entries(collection.fields)
    .filter(([, field]) => field.kind === 'relation')
    .map(([name, field]) => {
      const options = field.options as RelationFieldOptions;
      return { name, targetSlug: options.collection, many: options.many === true };
    });
}

export async function populateRecords<TEnv>(
  records: DatabaseRecord[],
  collection: CollectionDefinition,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<DatabaseRecord[]> {
  const relationFields = getRelationFields(collection);
  if (relationFields.length === 0 || records.length === 0) return records;

  const populated = records.map((record) => ({ ...record }));

  for (const { name, targetSlug, many } of relationFields) {
    if (!runtime.getCollection(targetSlug)) continue;

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

    const related = await runtime.adapters.database.findMany({
      collection: targetSlug,
      where: { id: { in: Array.from(ids) } }
    });
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

export async function populateRecord<TEnv>(
  record: DatabaseRecord,
  collection: CollectionDefinition,
  runtime: ForgeCmsRuntime<TEnv>
): Promise<DatabaseRecord> {
  const [result] = await populateRecords([record], collection, runtime);
  return result ?? record;
}
