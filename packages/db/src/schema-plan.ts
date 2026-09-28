import type { AnyField, CollectionDefinition } from '@forge-cms/core';
import {
  addColumnSql,
  createIndexSql,
  createTableSql,
  desiredTableSchema,
  type DesiredTable,
  type ResolvedIndex
} from './schema-generator.js';

// Schema drift detection and upgrade planning (spec 070, roadmap 0.7 M01). Everything here is pure
// over a normalized stored schema and a small probe interface; the SQLite specifics (PRAGMA reads,
// probe SQL, the transactional apply) live in `sqlite-schema.ts`.

/** What `syncSchema()` may do about a change. Only `safe-additive` is ever applied automatically. */
export type SchemaChangeClassification =
  /** Applied by `syncSchema()` when nothing in the plan blocks. */
  | 'safe-additive'
  /** Forge understands the change but will not transform existing data. Blocks `syncSchema()`. */
  | 'manual-migration'
  /** Forge cannot determine a safe transformation. Blocks `syncSchema()`. */
  | 'unsupported'
  /** Recorded for the operator; nothing to do, does not block. */
  | 'informational';

/** The kinds of change a plan reports, in the order a plan lists them within a table. */
export const SCHEMA_CHANGE_KINDS = [
  'table-added',
  'table-structure',
  'baseline-recorded',
  'baseline-unreadable',
  'system-column-added',
  'system-column-removed',
  'column-added',
  'column-removed',
  'column-type-changed',
  'field-kind-changed',
  'field-localized-changed',
  'field-cardinality-changed',
  'field-target-changed',
  'field-required-added',
  'field-default-changed',
  'index-added',
  'index-removed',
  'index-changed'
] as const;

export type SchemaChangeKind = (typeof SCHEMA_CHANGE_KINDS)[number];

/** One difference between the desired Forge schema and the persisted one. */
export interface SchemaChange {
  /** The physical table (a collection slug, or an internal `_versions_`/`_global_`/`_forge_` table). */
  table: string;
  kind: SchemaChangeKind;
  target: { type: 'table' | 'column' | 'system-column' | 'index'; name: string };
  classification: SchemaChangeClassification;
  /** Why it is classified this way and what to do about it. Never contains row values. */
  reason: string;
  /** What is stored now, e.g. `TEXT` or `non-unique (slug)`. */
  stored?: string;
  /** What the Forge schema declares. */
  desired?: string;
  /** Rows the change concerns (rows lacking a required value, duplicate rows, draft rows, ...). */
  affectedRows?: number;
  /** For a unique index over existing data: how many distinct values are duplicated. */
  duplicateGroups?: number;
}

/** A complete, deterministically ordered schema plan. */
export interface SchemaPlan {
  changes: readonly SchemaChange[];
  /** `true` when any change is `manual-migration` or `unsupported`: `syncSchema()` then applies nothing. */
  blocking: boolean;
}

/** `syncSchema()` refused: the plan has changes it will not apply. Nothing was executed. */
export class SchemaDriftError extends Error {
  readonly code = 'SCHEMA_DRIFT';
  readonly plan: SchemaPlan;

  constructor(plan: SchemaPlan, message?: string, options?: { cause?: unknown }) {
    const blocking = plan.changes.filter((c) => isBlocking(c.classification)).length;
    super(
      message ??
        `Schema drift detected: ${blocking} blocking ${blocking === 1 ? 'change' : 'changes'}; ` +
          `syncSchema() applied nothing.\n\n${formatSchemaPlan(plan)}`,
      options
    );
    this.name = 'SchemaDriftError';
    this.plan = plan;
  }
}

export function isSchemaDriftError(err: unknown): err is SchemaDriftError {
  return (
    err instanceof SchemaDriftError ||
    (err instanceof Error &&
      (err as { code?: unknown }).code === 'SCHEMA_DRIFT' &&
      typeof (err as { plan?: unknown }).plan === 'object')
  );
}

function isBlocking(classification: SchemaChangeClassification): boolean {
  return classification === 'manual-migration' || classification === 'unsupported';
}

function compareChanges(a: SchemaChange, b: SchemaChange): number {
  if (a.table !== b.table) return a.table < b.table ? -1 : 1;
  const kind = SCHEMA_CHANGE_KINDS.indexOf(a.kind) - SCHEMA_CHANGE_KINDS.indexOf(b.kind);
  if (kind !== 0) return kind;
  if (a.target.name !== b.target.name) return a.target.name < b.target.name ? -1 : 1;
  return 0;
}

function toPlan(changes: SchemaChange[]): SchemaPlan {
  const sorted = [...changes].sort(compareChanges);
  return { changes: sorted, blocking: sorted.some((c) => isBlocking(c.classification)) };
}

/**
 * Combines plans (e.g. the runtime's and the auth adapter's) into one ordered plan. An identical
 * change reported by more than one plan (the shared `_forge_schema` table) is listed once.
 */
export function mergeSchemaPlans(plans: readonly SchemaPlan[]): SchemaPlan {
  const seen = new Set<string>();
  const changes: SchemaChange[] = [];
  for (const plan of plans) {
    for (const change of plan.changes) {
      // Only a fully identical change is a duplicate (e.g. the same `_forge_schema` creation reported by
      // the runtime and the auth adapter over one database); anything differing is kept.
      const key = JSON.stringify(change);
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push(change);
    }
  }
  return toPlan(changes);
}

const SECTIONS: { title: string; matches: (c: SchemaChangeClassification) => boolean }[] = [
  { title: 'Blocking (manual migration or unsupported)', matches: isBlocking },
  {
    title: 'Safe additive (applied by syncSchema() only when nothing blocks)',
    matches: (c) => c === 'safe-additive'
  },
  { title: 'Informational', matches: (c) => c === 'informational' }
];

/** A deterministic, human-readable rendering of a plan for errors, logs and docs. No row values. */
export function formatSchemaPlan(plan: SchemaPlan): string {
  if (plan.changes.length === 0) return 'Schema plan: no changes.';
  const count = (m: (c: SchemaChangeClassification) => boolean) =>
    plan.changes.filter((c) => m(c.classification)).length;
  const lines = [
    `Schema plan: ${count(isBlocking)} blocking, ${count((c) => c === 'safe-additive')} safe additive, ` +
      `${count((c) => c === 'informational')} informational.`
  ];
  for (const section of SECTIONS) {
    const changes = plan.changes.filter((c) => section.matches(c.classification));
    if (changes.length === 0) continue;
    lines.push('', `${section.title}:`);
    for (const change of changes) {
      const where =
        change.target.type === 'table' ? change.table : `${change.table}.${change.target.name}`;
      lines.push(`  ${where}  ${change.kind}  [${change.classification}]`);
      if (change.stored !== undefined || change.desired !== undefined) {
        lines.push(
          `    stored: ${change.stored ?? '(none)'}; desired: ${change.desired ?? '(none)'}`
        );
      }
      lines.push(`    ${change.reason}`);
    }
  }
  return lines.join('\n');
}

// --- Normalized stored schema -----------------------------------------------------------------

/** A column as SQLite reports it (`pragma_table_info`). */
export interface StoredColumn {
  name: string;
  /** Declared type, as written in the DDL (may be empty). */
  type: string;
  /** Position in the primary key, 0 when not part of it. */
  primaryKey: number;
}

/** An index as SQLite reports it (`pragma_index_list` + `pragma_index_info`). */
export interface StoredIndex {
  name: string;
  /** Indexed columns in key order; `null` for an expression. */
  columns: (string | null)[];
  unique: boolean;
  /** `c` = `CREATE INDEX`, `u` = a column/table `UNIQUE` constraint, `pk` = the primary key's autoindex. */
  origin: string;
  partial: boolean;
}

/** One persisted table, normalized: columns in declaration order, indexes sorted by name. */
export interface StoredTable {
  name: string;
  columns: StoredColumn[];
  indexes: StoredIndex[];
}

/**
 * SQLite type affinity of a declared type (sqlite.org/datatype3.html §3.1, rules applied in order).
 * Comparing affinities keeps cosmetic spellings (`VARCHAR(20)` vs `TEXT`) from reading as drift.
 */
export function sqliteAffinity(
  declaredType: string
): 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC' {
  const type = declaredType.toUpperCase();
  if (type.includes('INT')) return 'INTEGER';
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT';
  if (type.includes('BLOB') || type.trim() === '') return 'BLOB';
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

// --- Semantic baseline ------------------------------------------------------------------------

/** The table Forge records each synced table's semantic baseline in (spec 070 §1). */
export const SCHEMA_BASELINE_TABLE = '_forge_schema';

/** Semantic facts of one field that the physical schema cannot show. */
export interface FieldBaseline {
  kind: string;
  localized: boolean;
  many: boolean;
  /** relation/upload target collection. */
  target: string | null;
  required: boolean;
  /** The static `defaultValue` as JSON, `'dynamic'` for a non-JSON one (Date, function, ...), `null` when none. */
  default: string | null;
}

export interface TableBaseline {
  format: 1;
  fields: Record<string, FieldBaseline>;
}

function fieldBaseline(field: AnyField): FieldBaseline {
  const options = field.options as {
    localized?: boolean;
    many?: boolean;
    collection?: unknown;
    required?: boolean;
    defaultValue?: unknown;
  };
  const referencing = field.kind === 'relation' || field.kind === 'upload';
  let defaultJson: string | null = null;
  const value = options.defaultValue;
  if (value !== undefined) {
    // Only plain JSON data is a comparable default. A Date/function/class instance is evaluated per
    // process, so it gets one stable marker instead of a value that "changes" on every start.
    const plain =
      value === null ||
      ['string', 'number', 'boolean'].includes(typeof value) ||
      Array.isArray(value) ||
      (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
    let json: string | undefined;
    try {
      json = plain ? JSON.stringify(value) : undefined;
    } catch {
      json = undefined;
    }
    defaultJson = json ?? 'dynamic';
  }
  return {
    kind: field.kind,
    localized: options.localized === true,
    many: field.kind === 'relation' && options.many === true,
    target: referencing && typeof options.collection === 'string' ? options.collection : null,
    required: options.required === true,
    default: defaultJson
  };
}

/** The baseline a collection definition records, fields sorted by name so it serializes stably. */
export function tableBaseline(collection: CollectionDefinition): TableBaseline {
  const fields: Record<string, FieldBaseline> = {};
  for (const name of Object.keys(collection.fields).sort()) {
    const field = collection.fields[name];
    if (field) fields[name] = fieldBaseline(field);
  }
  return { format: 1, fields };
}

function isFieldBaseline(value: unknown): value is FieldBaseline {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const nullableString = (x: unknown) => x === null || typeof x === 'string';
  return (
    typeof v.kind === 'string' &&
    typeof v.localized === 'boolean' &&
    typeof v.many === 'boolean' &&
    typeof v.required === 'boolean' &&
    nullableString(v.target) &&
    nullableString(v.default)
  );
}

/** Parses a stored baseline; `'unknown'` when it is not a format this version understands. */
export function parseTableBaseline(raw: unknown): TableBaseline | 'unknown' {
  if (typeof raw !== 'string') return 'unknown';
  try {
    const parsed = JSON.parse(raw) as { format?: unknown; fields?: unknown };
    if (parsed.format !== 1 || typeof parsed.fields !== 'object' || parsed.fields === null) {
      return 'unknown';
    }
    for (const entry of Object.values(parsed.fields as Record<string, unknown>)) {
      if (!isFieldBaseline(entry)) return 'unknown';
    }
    return parsed as TableBaseline;
  } catch {
    return 'unknown';
  }
}

// --- Planning ---------------------------------------------------------------------------------

/**
 * Read-only data questions the planner asks, only for the changes whose classification depends on
 * existing data. Implementations answer with SQL aggregates and never load rows.
 */
export interface SchemaProbe {
  rowCount(table: string): Promise<number>;
  nullCount(table: string, column: string): Promise<number>;
  valueCount(table: string, column: string, value: string): Promise<number>;
  /** Groups of rows sharing all of `columns`, ignoring rows with a NULL in any of them (SQLite's unique rule). */
  duplicates(table: string, columns: string[]): Promise<{ groups: number; rows: number }>;
  /** The table an index of this name belongs to (index names are global to a SQLite database), or `null`. */
  indexTable(name: string): Promise<string | null>;
}

/** One table to plan. */
export interface TablePlanInput {
  collection: CollectionDefinition;
  stored: StoredTable | null;
  /** `null` = no baseline recorded yet; `'unknown'` = unreadable. Ignored when `recordsBaseline` is false. */
  baseline: TableBaseline | 'unknown' | null;
  /** Whether Forge keeps a semantic baseline for this table (every table but `_forge_schema`). */
  recordsBaseline: boolean;
}

export interface TablePlanResult {
  changes: SchemaChange[];
  /** DDL for this table's safe-additive changes, in execution order. */
  statements: string[];
}

const LOOSE_TEXT_KINDS = new Set(['text', 'textarea']);
const CONSTRAINED_TEXT_KINDS = new Set(['email', 'slug', 'select']);

/**
 * A kind change within one storage type. Only moves onto an unconstrained plain string (`text` or
 * `textarea`) from another plain string kind keep both the representation and validity of every
 * stored value; anything else (a new format rule, JSON ⇄ string, ids, dates) needs a reviewed migration.
 */
function kindChangeClassification(from: string, to: string): SchemaChangeClassification {
  if (
    LOOSE_TEXT_KINDS.has(to) &&
    (LOOSE_TEXT_KINDS.has(from) || CONSTRAINED_TEXT_KINDS.has(from))
  ) {
    return 'informational';
  }
  return 'manual-migration';
}

function describeIndex(index: { columns: readonly (string | null)[]; unique: boolean }): string {
  const columns = index.columns.map((c) => c ?? '<expression>').join(', ');
  return `${index.unique ? 'unique' : 'non-unique'} (${columns})`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * SQLite index names are global to the database, while Forge derives them from the table and its
 * columns (`idx_<table>_<columns>`), so two tables can resolve to one name (`blog` + `posts_slug`
 * and `blog_posts` + `slug`). `CREATE INDEX IF NOT EXISTS` would then silently skip the second
 * one and its rule would never exist; a collision is reported instead.
 */
async function indexNameCollision(
  table: string,
  index: ResolvedIndex,
  probe: SchemaProbe
): Promise<SchemaChange | null> {
  const owner = await probe.indexTable(index.name);
  if (owner === null || owner === table) return null;
  return {
    table,
    kind: 'index-added',
    target: { type: 'index', name: index.name },
    classification: 'unsupported',
    desired: describeIndex({ columns: index.fields, unique: index.unique }),
    reason:
      `An index named "${index.name}" already exists on table "${owner}" (SQLite index names are ` +
      'database-wide), so this index cannot be created under its generated name. Rename one of the ' +
      'collections or fields.'
  };
}

/** Plans one table. `probe` is only consulted for existing tables. */
export async function planTable(
  input: TablePlanInput,
  probe: SchemaProbe
): Promise<TablePlanResult> {
  const desired = desiredTableSchema(input.collection);
  const table = desired.name;
  const changes: SchemaChange[] = [];
  const statements: string[] = [];

  if (input.stored === null) {
    changes.push({
      table,
      kind: 'table-added',
      target: { type: 'table', name: table },
      classification: 'safe-additive',
      reason: 'New table; created with all of its columns and indexes.'
    });
    statements.push(
      createTableSql(desired),
      ...desired.indexes.map((i) => createIndexSql(table, i))
    );
    for (const index of desired.indexes) {
      const collision = await indexNameCollision(table, index, probe);
      if (collision) changes.push(collision);
    }
    return { changes, statements };
  }

  const stored = input.stored;
  let rows: number | undefined;
  const rowCount = async () => (rows ??= await probe.rowCount(table));
  const storedColumns = new Map(stored.columns.map((c) => [c.name, c]));
  const desiredNames = new Set(desired.columns.map((c) => c.name));
  const addStatements: string[] = [];

  // Structure Forge relies on and cannot repair: the TEXT `id` primary key and the timestamps.
  const structureProblems: string[] = [];
  const id = storedColumns.get('id');
  const pkColumns = stored.columns.filter((c) => c.primaryKey > 0).map((c) => c.name);
  if (!id || id.primaryKey === 0 || pkColumns.length !== 1 || sqliteAffinity(id.type) !== 'TEXT') {
    structureProblems.push(
      `"id" must be the table's only primary key with TEXT affinity (stored primary key: ${pkColumns.join(', ') || 'none'})`
    );
  }
  for (const name of ['created_at', 'updated_at']) {
    const column = storedColumns.get(name);
    if (!column) structureProblems.push(`system column "${name}" is missing`);
    else if (sqliteAffinity(column.type) !== 'TEXT') {
      structureProblems.push(`system column "${name}" is ${column.type || 'untyped'}, not TEXT`);
    }
  }
  if (structureProblems.length > 0) {
    changes.push({
      table,
      kind: 'table-structure',
      target: { type: 'table', name: table },
      classification: 'unsupported',
      reason:
        `The stored table is not a Forge table layout: ${structureProblems.join('; ')}. Forge cannot ` +
        'rebuild a table; recreate it in a reviewed migration.'
    });
  }

  // Semantic baseline (spec 070 §1).
  const baseline = input.recordsBaseline ? input.baseline : null;
  if (input.recordsBaseline && input.baseline === null) {
    changes.push({
      table,
      kind: 'baseline-recorded',
      target: { type: 'table', name: table },
      classification: 'informational',
      reason:
        'No Forge schema baseline existed for this table (first sync since spec 070). Physical checks ran; ' +
        'semantic options the database cannot show (localized, relation cardinality/target, kind within ' +
        'one storage type, required, defaults) could not be compared with the previous configuration. ' +
        'The current configuration is recorded as the baseline.'
    });
  } else if (input.recordsBaseline && input.baseline === 'unknown') {
    changes.push({
      table,
      kind: 'baseline-unreadable',
      target: { type: 'table', name: table },
      classification: 'unsupported',
      reason:
        `The stored "${SCHEMA_BASELINE_TABLE}" baseline for this table is unreadable or from a newer ` +
        'ForgeCMS format; this version cannot compare against it.'
    });
  }
  const known = baseline === 'unknown' ? null : baseline;

  // System columns Forge owns beyond id/timestamps.
  for (const [name, enabled, feature] of [
    ['_status', input.collection.drafts === true, 'drafts'],
    ['_storageKey', input.collection.upload === true, 'upload']
  ] as const) {
    const present = storedColumns.get(name);
    if (enabled && !present) {
      const count = await rowCount();
      const column = desired.columns.find((c) => c.name === name);
      if (!column) throw new Error(`Internal: desired schema of "${table}" lacks "${name}"`);
      if (count === 0) {
        changes.push({
          table,
          kind: 'system-column-added',
          target: { type: 'system-column', name },
          classification: 'safe-additive',
          reason: `${feature} enabled on an empty table; the "${name}" column is added.`,
          desired: 'TEXT'
        });
        addStatements.push(addColumnSql(table, column));
      } else {
        changes.push({
          table,
          kind: 'system-column-added',
          target: { type: 'system-column', name },
          classification: 'manual-migration',
          desired: 'TEXT',
          affectedRows: count,
          reason:
            name === '_status'
              ? `drafts enabled on a table with ${plural(count, 'row')}: they would have no status, and ` +
                'anonymous reads only return published documents, so they would disappear from public ' +
                "reads. Add the column and set \"_status\" to 'published' or 'draft' for every row in a " +
                'reviewed migration.'
              : `upload enabled on a table with ${plural(count, 'row')}: they are not file records (no ` +
                'stored object key). Add the column and backfill "_storageKey" (or move the rows) in a ' +
                'reviewed migration.'
        });
      }
    } else if (!enabled && present) {
      let reason: string;
      let affectedRows: number | undefined;
      if (name === '_status') {
        affectedRows = await probe.valueCount(table, '_status', 'draft');
        reason =
          `drafts are disabled but the "_status" column is still stored` +
          (affectedRows > 0
            ? `; ${plural(affectedRows, 'draft row')} would become readable as published content`
            : '') +
          '. Publish or delete the drafts and drop the column in a reviewed migration.';
      } else {
        reason =
          'upload is disabled but the "_storageKey" column is still stored; the stored objects it ' +
          'references would no longer be managed. Decide what happens to them and drop the column in a ' +
          'reviewed migration.';
      }
      changes.push({
        table,
        kind: 'system-column-removed',
        target: { type: 'system-column', name },
        classification: 'manual-migration',
        stored: present.type || 'untyped',
        reason,
        ...(affectedRows !== undefined && affectedRows > 0 && { affectedRows })
      });
    } else if (enabled && present && sqliteAffinity(present.type) !== 'TEXT') {
      changes.push({
        table,
        kind: 'table-structure',
        target: { type: 'system-column', name },
        classification: 'unsupported',
        stored: present.type || 'untyped',
        desired: 'TEXT',
        reason: `The Forge system column "${name}" is not TEXT; Forge cannot retype it.`
      });
    }
  }

  // Declared fields.
  for (const column of desired.columns) {
    if (column.role !== 'field' || !column.field) continue;
    const field = column.field;
    const current = fieldBaseline(field);
    const present = storedColumns.get(column.name);

    if (!present) {
      if (current.required) {
        const count = await rowCount();
        if (count > 0) {
          changes.push({
            table,
            kind: 'column-added',
            target: { type: 'column', name: column.name },
            classification: 'manual-migration',
            desired: column.type,
            affectedRows: count,
            reason:
              `New required field on a table with ${plural(count, 'row')}: none of them has a value, ` +
              'and a default only applies to documents created later. Add the column and backfill it in ' +
              'a reviewed migration.'
          });
          continue;
        }
      }
      changes.push({
        table,
        kind: 'column-added',
        target: { type: 'column', name: column.name },
        classification: 'safe-additive',
        desired: column.type,
        reason:
          current.default !== null
            ? 'New optional field; existing rows read as empty (a default only applies to new documents).'
            : 'New optional field; existing rows read as empty.'
      });
      addStatements.push(addColumnSql(table, column));
      continue;
    }

    const storedAffinity = sqliteAffinity(present.type);
    const previous = known?.fields[column.name];
    // A NUMERIC column (e.g. a hand-declared BOOLEAN or DECIMAL) stores integers and reals as such.
    const compatible =
      storedAffinity === column.type ||
      (storedAffinity === 'NUMERIC' && (column.type === 'INTEGER' || column.type === 'REAL'));
    if (!compatible) {
      changes.push({
        table,
        kind: 'column-type-changed',
        target: { type: 'column', name: column.name },
        classification: 'manual-migration',
        stored: present.type || 'untyped',
        desired: column.type,
        reason:
          (previous && previous.kind !== current.kind
            ? `Field kind changed from ${previous.kind} to ${current.kind}. `
            : '') +
          'The stored values are in the old storage type; Forge never converts values. Convert the column ' +
          'in a reviewed migration.'
      });
      continue;
    }
    if (!known) continue;

    if (previous) {
      if (previous.kind !== current.kind) {
        const classification = kindChangeClassification(previous.kind, current.kind);
        changes.push({
          table,
          kind: 'field-kind-changed',
          target: { type: 'column', name: column.name },
          classification,
          stored: previous.kind,
          desired: current.kind,
          reason:
            classification === 'informational'
              ? 'Same stored representation and no new validation rule; existing values stay valid.'
              : `Both are stored as ${column.type}, but the stored values are ${previous.kind} values ` +
                `(representation or validation differs for ${current.kind}). Convert them in a reviewed ` +
                'migration.'
        });
      }
      if (previous.localized !== current.localized) {
        changes.push({
          table,
          kind: 'field-localized-changed',
          target: { type: 'column', name: column.name },
          classification: 'manual-migration',
          stored: previous.localized ? 'localized' : 'not localized',
          desired: current.localized ? 'localized' : 'not localized',
          reason: current.localized
            ? 'Stored values are plain values; a localized field stores a JSON map per locale ' +
              '({"en": ...}). Wrap them under a locale in a reviewed migration.'
            : "Stored values are per-locale JSON maps; choose which locale's value to keep in a reviewed " +
              'migration.'
        });
      }
      if (previous.many !== current.many) {
        changes.push({
          table,
          kind: 'field-cardinality-changed',
          target: { type: 'column', name: column.name },
          classification: 'manual-migration',
          stored: previous.many ? 'many' : 'single',
          desired: current.many ? 'many' : 'single',
          reason: current.many
            ? 'Stored values are single ids; a many relation stores a JSON array of ids. Convert them in ' +
              'a reviewed migration.'
            : 'Stored values are JSON arrays of ids; choose the id to keep in a reviewed migration.'
        });
      }
      if (previous.target !== current.target) {
        changes.push({
          table,
          kind: 'field-target-changed',
          target: { type: 'column', name: column.name },
          classification: 'manual-migration',
          stored: previous.target ?? '(none)',
          desired: current.target ?? '(none)',
          reason:
            'Stored ids refer to documents of the previous target collection. Re-point them in a reviewed ' +
            'migration.'
        });
      }
      if (previous.default !== current.default) {
        changes.push({
          table,
          kind: 'field-default-changed',
          target: { type: 'column', name: column.name },
          classification: 'informational',
          stored: previous.default ?? '(none)',
          desired: current.default ?? '(none)',
          reason:
            'Defaults apply to documents created from now on; existing rows are not rewritten.'
        });
      }
    }

    // Newly required relative to the baseline (or a column Forge did not declare at baseline time).
    if (current.required && previous?.required !== true) {
      const missing = await probe.nullCount(table, column.name);
      changes.push({
        table,
        kind: 'field-required-added',
        target: { type: 'column', name: column.name },
        classification: missing > 0 ? 'manual-migration' : 'informational',
        ...(missing > 0 && { affectedRows: missing }),
        reason:
          missing > 0
            ? `The field is now required but ${plural(missing, 'row has', 'rows have')} no value. Backfill ` +
              'them in a reviewed migration.'
            : 'The field is now required; every existing row already has a value.'
      });
    }
  }

  // Stored columns the Forge schema no longer declares (removed fields, rename sources, stray columns).
  for (const column of stored.columns) {
    if (desiredNames.has(column.name)) continue;
    if (column.name === '_status' || column.name === '_storageKey') continue; // handled above
    changes.push({
      table,
      kind: 'column-removed',
      target: { type: 'column', name: column.name },
      classification: 'manual-migration',
      stored: column.type || 'untyped',
      reason:
        'Still stored but no longer declared. Forge never drops columns and never infers a rename; if ' +
        'the data moved to another field, copy it there, then drop this column in a reviewed migration.'
    });
  }

  // Indexes: compared by ordered columns and uniqueness, not by name alone.
  const indexStatements = await planIndexes(desired, stored, probe, changes, storedColumns);

  return { changes, statements: [...addStatements, ...indexStatements] };
}

async function planIndexes(
  desired: DesiredTable,
  stored: StoredTable,
  probe: SchemaProbe,
  changes: SchemaChange[],
  storedColumns: Map<string, StoredColumn>
): Promise<string[]> {
  const table = desired.name;
  const statements: string[] = [];
  const candidates = stored.indexes.filter((i) => i.origin !== 'pk');
  const matched = new Set<string>();
  const same = (s: StoredIndex, d: ResolvedIndex) =>
    !s.partial &&
    s.unique === d.unique &&
    s.columns.length === d.fields.length &&
    s.columns.every((c, i) => c === d.fields[i]);

  for (const index of desired.indexes) {
    const byName = candidates.find((s) => s.name === index.name);
    if (byName) {
      matched.add(byName.name);
      if (same(byName, index)) continue;
      const desiredText = describeIndex({ columns: index.fields, unique: index.unique });
      const storedText = describeIndex(byName) + (byName.partial ? ' partial' : '');
      let reason: string;
      if (byName.unique && !index.unique) {
        reason =
          'The stored index is UNIQUE but the Forge schema no longer requires uniqueness: SQLite would ' +
          'still reject duplicates. Replace the index in a reviewed migration.';
      } else if (!byName.unique && index.unique) {
        reason =
          'The Forge schema now requires uniqueness but the stored index of the same name is not unique, ' +
          'and SQLite cannot make an index unique in place. Replace it in a reviewed migration (check for ' +
          'duplicates first).';
      } else {
        reason =
          'An index with this name covers different columns. Replace it in a reviewed migration.';
      }
      changes.push({
        table,
        kind: 'index-changed',
        target: { type: 'index', name: index.name },
        classification: 'manual-migration',
        stored: storedText,
        desired: desiredText,
        reason
      });
      continue;
    }

    const equivalent = candidates.find((s) => !matched.has(s.name) && same(s, index));
    if (equivalent) {
      matched.add(equivalent.name);
      continue;
    }

    const collision = await indexNameCollision(table, index, probe);
    if (collision) {
      changes.push(collision);
      continue;
    }
    const desiredText = describeIndex({ columns: index.fields, unique: index.unique });
    if (index.unique && index.fields.every((f) => storedColumns.has(f))) {
      const duplicates = await probe.duplicates(table, index.fields);
      if (duplicates.groups > 0) {
        changes.push({
          table,
          kind: 'index-added',
          target: { type: 'index', name: index.name },
          classification: 'manual-migration',
          desired: desiredText,
          duplicateGroups: duplicates.groups,
          affectedRows: duplicates.rows,
          reason:
            `Cannot add the unique index: existing data has ${plural(duplicates.groups, 'duplicated value')} ` +
            `(${index.fields.join(', ')}) across ${plural(duplicates.rows, 'row')}. Forge never deletes or ` +
            'rewrites rows; resolve the duplicates, then sync again.'
        });
        continue;
      }
    }
    changes.push({
      table,
      kind: 'index-added',
      target: { type: 'index', name: index.name },
      classification: 'safe-additive',
      desired: desiredText,
      reason: index.unique
        ? 'New unique index; existing data has no duplicates, so it is created.'
        : 'New index.'
    });
    statements.push(createIndexSql(table, index));
  }

  for (const index of candidates) {
    if (matched.has(index.name)) continue;
    const storedText = describeIndex(index) + (index.partial ? ' partial' : '');
    if (index.origin === 'u') {
      changes.push({
        table,
        kind: 'index-removed',
        target: { type: 'index', name: index.name },
        classification: 'unsupported',
        stored: storedText,
        reason:
          'A UNIQUE constraint declared in the table definition, which the Forge schema does not ' +
          'declare. SQLite can only remove it by rebuilding the table.'
      });
    } else if (index.unique) {
      changes.push({
        table,
        kind: 'index-removed',
        target: { type: 'index', name: index.name },
        classification: 'manual-migration',
        stored: storedText,
        reason:
          'A UNIQUE index the Forge schema does not declare still rejects duplicates. Declare it, or drop ' +
          'it in a reviewed migration.'
      });
    } else {
      changes.push({
        table,
        kind: 'index-removed',
        target: { type: 'index', name: index.name },
        classification: 'informational',
        stored: storedText,
        reason:
          'An index the Forge schema does not declare. It changes no behaviour; drop it when convenient.'
      });
    }
  }
  return statements;
}

/** Orders a set of table results into one plan. */
export function toSchemaPlan(changes: SchemaChange[]): SchemaPlan {
  return toPlan(changes);
}
