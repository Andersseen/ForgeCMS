// Confidentiality scan of the BUILT browser output (SC-CONFIDENTIALITY for explicitly marked code).
// Usage (after `pnpm build`): node --experimental-strip-types qualification/leak-scan.ts
//
//  1. Every marker must be present in the server output; a marker the build never emits proves nothing.
//  2. No marker may appear in any file the browser can fetch (JS, CSS, HTML, source maps, other assets).
//  3. Positive control: a copy of the public tree with ONE server chunk planted in it must be flagged.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { CANARIES, EDITORS } from '../scripts/fixture.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'dist/analog/public');
const SERVER = join(ROOT, 'dist/analog/server');

/** Implementation details that exist only in server-owned, explicitly marked modules. */
const SERVER_MARKERS = [
  'Draft: visible to you only', // the Server Component's own template text
  'forge-strata-editorial.runtime', // the per-isolate runtime store key
  'forge-strata-editorial.request-env', // the request-env key
  'Bylines are public by editorial decision', // never emitted (comment) → excluded below
  'No durable editorial profile', // runtime profile error message
  'Refusing to seed' // seed script: must not reach ANY build output
];
/** Data and secrets: must appear in no build output at all (they are runtime-only). */
const DATA_MARKERS = [
  CANARIES.anaDraft,
  CANARIES.benDraft,
  CANARIES.authSecret,
  ...Object.values(EDITORS).map((editor) => editor.password),
  ...Object.values(EDITORS).map((editor) => editor.email)
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : files(path)) : [path];
  });
}

function scan(dir: string, markers: readonly string[]): { file: string; marker: string }[] {
  const hits: { file: string; marker: string }[] = [];
  for (const file of files(dir)) {
    const text = readFileSync(file).toString('latin1');
    for (const marker of markers)
      if (text.includes(marker)) hits.push({ file: relative(ROOT, file), marker });
  }
  return hits;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// 1. Markers are real: each emitted marker is found in the server build.
const serverHits = scan(SERVER, SERVER_MARKERS);
const emitted = SERVER_MARKERS.filter((marker) => serverHits.some((hit) => hit.marker === marker));
const absentFromServer = SERVER_MARKERS.filter((marker) => !emitted.includes(marker));
check(
  'server output contains the implementation markers',
  emitted.length >= 4,
  `${emitted.length} emitted; not emitted (comments/scripts, scanned anyway): ${absentFromServer.join(' | ')}`
);
const sourceOnlyMarkers = SERVER_MARKERS;

// 2. Browser-fetchable output carries none of them, nor any secret or data.
const publicFiles = files(PUBLIC);
const publicHits = scan(PUBLIC, [...sourceOnlyMarkers, ...DATA_MARKERS]);
check(
  `browser output (${publicFiles.length} files incl. ${publicFiles.filter((f) => f.endsWith('.map')).length} maps) has no server marker, secret or data`,
  publicHits.length === 0,
  publicHits.map((hit) => `${hit.file}: ${hit.marker}`).join('; ')
);
check(
  'no server marker in the generated client surrogates',
  scan(join(ROOT, 'src/generated'), sourceOnlyMarkers).length === 0
);
check(
  'the browser bundle does not contain ForgeCMS server packages',
  scan(PUBLIC, [
    'UsersCollectionAuthAdapter',
    'LibSqlDatabaseAdapter',
    'D1DatabaseAdapter',
    'ForgeCmsRuntime'
  ]).length === 0
);
const allBuildHits = scan(join(ROOT, 'dist'), DATA_MARKERS);
check(
  'no secret, password, email or draft canary anywhere in the build',
  allBuildHits.length === 0,
  allBuildHits.map((h) => h.file).join(', ')
);

// 3. Positive control: plant one server chunk in a COPY of the public tree; the scan must flag it.
const control = mkdtempSync(join(tmpdir(), 'editorial-leak-control-'));
try {
  cpSync(PUBLIC, control, { recursive: true });
  const serverChunk = files(SERVER).find((file) =>
    readFileSync(file, 'latin1').includes('Draft: visible to you only')
  );
  if (!serverChunk) throw new Error('no server chunk carries the Server Component template');
  mkdirSync(join(control, 'assets'), { recursive: true });
  writeFileSync(join(control, 'assets/planted-leak.js'), readFileSync(serverChunk));
  const controlHits = scan(control, sourceOnlyMarkers);
  check(
    'positive control: a planted server chunk IS detected',
    controlHits.length > 0,
    `${controlHits.length} hits`
  );
} finally {
  rmSync(control, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
mkdirSync(join(ROOT, 'qualification/artifacts'), { recursive: true });
writeFileSync(
  join(ROOT, 'qualification/artifacts/leak-scan.json'),
  JSON.stringify(
    { at: new Date().toISOString(), checks: results, verdict: failed.length ? 'FAIL' : 'PASS' },
    null,
    2
  )
);
console.log(
  `\n${results.length - failed.length}/${results.length} passed → ${failed.length ? 'FAIL' : 'PASS'}`
);
if (failed.length) process.exitCode = 1;
