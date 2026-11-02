/**
 * The website's translation catalogs (spec 101). Glossa is the source of truth; this script moves
 * catalogs between Glossa and `src/app/i18n/catalogs/` and refuses anything Etyma would not render.
 *
 *   node scripts/i18n-catalogs.mjs check          offline: validate the snapshot + its typed contract
 *   node scripts/i18n-catalogs.mjs pull           Glossa Public Delivery → snapshot (no token needed)
 *   node scripts/i18n-catalogs.mjs pull --verify  same, but fail instead of writing when it differs
 *   node scripts/i18n-catalogs.mjs push           snapshot → Glossa Machine API (GLOSSA_TOKEN, owner only)
 *
 * `pull` and `check` exit non-zero on a missing locale, an invalid catalog, a missing or extra key, a
 * MessageFormat 2 error, or a source catalog whose keys/variables no longer match the committed
 * contract: a build must fail rather than publish English (or a broken key) under /es or /uk.
 * The token is read from the environment only and is never printed.
 */
/* global fetch -- Node 22's built-in fetch; these scripts lint without Node globals. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  extractContractKeys,
  extractContractParams,
  renderContractModule,
  validateCatalogs
} from '@etyma/tooling';
import prettier from 'prettier';
import { SITE_LOCALES, SOURCE_LOCALE } from '../src/app/i18n/site-locales.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogsDir = resolve(root, 'src/app/i18n/catalogs');
const contractPath = resolve(root, 'src/app/i18n/contract.generated.ts');

const GLOSSA_ORIGIN = env.GLOSSA_URL ?? 'https://glossa.andersseen.dev';
/** The project slug as Glossa reports it (`get_project`), not a guess. */
const GLOSSA_PROJECT = env.GLOSSA_PROJECT ?? 'forge-cms';

const catalogPath = (locale) => resolve(catalogsDir, `${locale}.json`);

async function readLocalCatalogs() {
  const catalogs = {};
  for (const locale of SITE_LOCALES) {
    catalogs[locale] = JSON.parse(await readFile(catalogPath(locale), 'utf8'));
  }
  return catalogs;
}

/** Etyma's validation, plus "every site locale is present": a missing locale is not "valid". */
function validateSiteCatalogs(catalogs) {
  const problems = [];
  for (const locale of SITE_LOCALES) {
    if (catalogs[locale] === undefined) problems.push(`[${locale}] catalog is missing`);
  }
  for (const locale of Object.keys(catalogs)) {
    if (!SITE_LOCALES.includes(locale)) problems.push(`[${locale}] is not a site locale`);
  }
  const result = validateCatalogs({ sourceLocale: SOURCE_LOCALE, catalogs });
  for (const d of result.diagnostics) {
    // Warnings (variable function mismatch) are reported but do not block, as Etyma intends.
    const line = `${d.severity} ${d.code} [${d.locale ?? '-'}] ${d.key ?? ''} ${d.message}`;
    if (d.severity === 'error') problems.push(line);
    else stderr.write(`${line}\n`);
  }
  return problems;
}

/** The typed contract module for a source catalog, byte-stable and formatted like the repo. */
async function renderContract(source) {
  const module = renderContractModule({
    keys: extractContractKeys(source),
    ...extractContractParams(source, { strict: true })
  });
  return format(module, 'typescript', contractPath);
}

async function format(text, parser, filepath) {
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, parser, filepath });
}

async function formatCatalog(catalog, locale) {
  return format(`${JSON.stringify(catalog, null, 2)}\n`, 'json', catalogPath(locale));
}

async function check() {
  const catalogs = await readLocalCatalogs();
  const problems = validateSiteCatalogs(catalogs);
  const expected = await renderContract(catalogs[SOURCE_LOCALE]);
  const actual = await readFile(contractPath, 'utf8').catch(() => '');
  if (expected !== actual) {
    problems.push(
      'contract.generated.ts does not match catalogs/en.json — run `pnpm --filter @forge-cms/www i18n:contract`'
    );
  }
  return problems;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return response.json();
}

/** Every site locale from Glossa Public Delivery, or an error naming what is missing. */
async function fetchRemoteCatalogs() {
  const base = `${GLOSSA_ORIGIN}/i18n/${GLOSSA_PROJECT}`;
  const manifest = await fetchJson(`${base}/manifest.json`);
  const missing = SITE_LOCALES.filter((locale) => !manifest?.catalogs?.[locale]?.url);
  if (missing.length > 0) {
    throw new Error(
      `Glossa project "${GLOSSA_PROJECT}" has no published catalog for: ${missing.join(', ')}`
    );
  }
  const catalogs = {};
  for (const locale of SITE_LOCALES)
    catalogs[locale] = await fetchJson(manifest.catalogs[locale].url);
  return catalogs;
}

async function pull({ verify }) {
  const remote = await fetchRemoteCatalogs();
  const problems = validateSiteCatalogs(remote);
  // The code was type-checked against the committed contract: a different key set or different
  // variables in Glossa needs a code change (a PR), not a silent rebuild.
  const contract = await renderContract(remote[SOURCE_LOCALE]);
  const committed = await readFile(contractPath, 'utf8').catch(() => '');
  if (contract !== committed) {
    problems.push(
      'Glossa source keys/variables differ from contract.generated.ts — update the site in a PR first'
    );
  }
  if (problems.length > 0) return problems;

  const changed = [];
  for (const locale of SITE_LOCALES) {
    const next = await formatCatalog(remote[locale], locale);
    const current = await readFile(catalogPath(locale), 'utf8').catch(() => '');
    if (next === current) continue;
    changed.push(locale);
    if (!verify) await writeFile(catalogPath(locale), next);
  }
  if (verify && changed.length > 0) {
    return [`snapshot differs from Glossa for: ${changed.join(', ')} — run \`i18n:pull\``];
  }
  stdout.write(
    changed.length > 0
      ? `Updated catalogs from Glossa: ${changed.join(', ')}\n`
      : 'Catalogs already match Glossa\n'
  );
  return [];
}

/**
 * Seeds Glossa from the snapshot through the Machine API, with its optimistic concurrency: a missing
 * catalog is created (`If-None-Match: *`); an existing one is left alone unless it already matches —
 * this never overwrites a catalog someone edited in Glossa.
 */
async function push() {
  const token = env.GLOSSA_TOKEN;
  if (!token) return ['GLOSSA_TOKEN is not set'];
  const catalogs = await readLocalCatalogs();
  const problems = validateSiteCatalogs(catalogs);
  if (problems.length > 0) return problems;

  const api = `${GLOSSA_ORIGIN}/api/machine/v1`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const project = await fetch(`${api}/project`, { headers }).then((r) => r.json());
  const configured = project?.data?.project?.locales ?? [];
  const unconfigured = SITE_LOCALES.filter((locale) => !configured.includes(locale));
  if (unconfigured.length > 0) {
    // A machine token cannot add a locale (LOCALE_NOT_CONFIGURED); the owner adds it in Glossa.
    problems.push(
      `not configured in the Glossa project yet (add them in Glossa, then re-run): ${unconfigured.join(', ')}`
    );
  }

  for (const locale of SITE_LOCALES.filter((l) => configured.includes(l))) {
    const current = await fetch(`${api}/catalogs/${locale}`, { headers });
    if (current.status === 200) {
      const { data } = await current.json();
      const same = JSON.stringify(data.content) === JSON.stringify(catalogs[locale]);
      if (!same) {
        problems.push(
          `[${locale}] already exists in Glossa with different content (revision ${data.revision}); not overwritten`
        );
      } else {
        stdout.write(`[${locale}] already up to date in Glossa\n`);
      }
      continue;
    }
    const created = await fetch(`${api}/catalogs/${locale}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json', 'if-none-match': '*' },
      body: JSON.stringify({ content: catalogs[locale] })
    });
    if (!created.ok) {
      const body = await created.json().catch(() => ({}));
      problems.push(`[${locale}] create failed: ${created.status} ${body?.error?.code ?? ''}`);
    } else {
      stdout.write(`[${locale}] created in Glossa\n`);
    }
  }
  return problems;
}

async function writeContract() {
  const source = JSON.parse(await readFile(catalogPath(SOURCE_LOCALE), 'utf8'));
  await writeFile(contractPath, await renderContract(source));
  stdout.write('Wrote contract.generated.ts\n');
  return [];
}

const commands = {
  check,
  pull: () => pull({ verify: argv.includes('--verify') }),
  push,
  contract: writeContract
};

const command = commands[argv[2] ?? ''];
if (!command) {
  stderr.write(`Usage: i18n-catalogs.mjs <${Object.keys(commands).join('|')}>\n`);
  exit(2);
}
try {
  const problems = await command();
  for (const problem of problems) stderr.write(`✗ ${problem}\n`);
  if (problems.length > 0) exit(1);
} catch (error) {
  stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
}
