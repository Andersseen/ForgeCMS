import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The committed historical checkpoints (spec 073 §3), oldest first. */
export const FIXTURE_VERSIONS = ['0.4.0', '0.6.0', '0.8.0'] as const;
export type FixtureVersion = (typeof FIXTURE_VERSIONS)[number];

export const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'upgrades'
);

export interface FixtureFeatures {
  localized: boolean;
  bootstrapClaim: boolean;
  uploadIntents: boolean;
  fullVersionSnapshots: boolean;
  schemaBaseline: boolean;
  appWrittenObjectWithMetadata: boolean;
}

export interface FixtureManifest {
  format: 1;
  forgeVersion: string;
  sourceKind: 'published-package' | 'git-source';
  sourceCommit: string;
  publishedAt: string;
  provenance: string;
  packages: Record<string, { version: string; integrity: string }>;
  resolvedDependencies: Record<string, string>;
  schemaProfile: string;
  generatedBy: string;
  generatedOn: string[];
  profilesIdentical: boolean;
  features: FixtureFeatures;
  counts: Record<string, number>;
  testCredentials: {
    admin: { email: string; password: string };
    editor: { email: string; password: string };
    apiKeys: {
      active: { id: string; token: string };
      revoked: { id: string; token: string };
    };
  };
  files: Record<string, string>;
}

export interface FixtureObject {
  key: string;
  file: string;
  sha256: string;
  size: number;
  contentType: string | null;
  metadata: Record<string, string>;
}

export interface Fixture {
  version: FixtureVersion;
  manifest: FixtureManifest;
  databaseSql: string;
  objects: (FixtureObject & { bytes: Uint8Array })[];
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path)];
  });
}

/**
 * Every file of the fixture must match the SHA-256 its manifest records, and no file may exist that
 * the manifest does not list. Historical fixtures are evidence: a mismatch fails, nothing regenerates.
 */
export function verifyFixtureIntegrity(version: FixtureVersion, root = FIXTURES_ROOT): string[] {
  const dir = join(root, version);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as FixtureManifest;
  const problems: string[] = [];
  if (manifest.forgeVersion !== version) {
    problems.push(`manifest.forgeVersion is ${manifest.forgeVersion}, directory is ${version}`);
  }
  const present = listFiles(dir)
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file !== 'manifest.json');
  for (const file of present) {
    if (!(file in manifest.files)) problems.push(`${file} is not listed in manifest.files`);
  }
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (!present.includes(file)) {
      problems.push(`${file} is listed but missing`);
      continue;
    }
    const actual = `sha256:${sha256Hex(readFileSync(join(dir, file)))}`;
    if (actual !== expected) problems.push(`${file}: expected ${expected}, found ${actual}`);
  }
  return problems;
}

/** Loads a fixture after verifying its integrity; throws on any mismatch. */
export function loadFixture(version: FixtureVersion): Fixture {
  const problems = verifyFixtureIntegrity(version);
  if (problems.length > 0) {
    throw new Error(`Fixture ${version} failed its integrity check:\n- ${problems.join('\n- ')}`);
  }
  const dir = join(FIXTURES_ROOT, version);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as FixtureManifest;
  const entries = JSON.parse(
    readFileSync(join(dir, 'storage-manifest.json'), 'utf8')
  ) as FixtureObject[];
  return {
    version,
    manifest,
    databaseSql: readFileSync(join(dir, 'database.sql'), 'utf8'),
    objects: entries.map((entry) => ({
      ...entry,
      bytes: new Uint8Array(readFileSync(join(dir, entry.file)))
    }))
  };
}
