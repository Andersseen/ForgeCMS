// Prints the INSTALLED Strata tuple and classifies it against the RC support contract
// (Strata docs/COMPATIBILITY.md "RC0 support contract"): all three at the same 1.0.0-rc.N, exact framework
// tuple. Exit 0 = installed tuple is a published RC; exit 2 = pre-RC baseline (rehearsal only); 1 = invalid.
import { readFileSync } from 'node:fs';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)));
const strata = ['@strata-sc/core', '@strata-sc/analog', '@strata-sc/server-components'].map((n) => [
  n,
  read(n).version
]);
const framework = {
  '@angular/core': '22.2.3',
  '@angular/compiler': '22.2.3',
  '@analogjs/router': '2.7.2',
  vite: '8.3.0',
  nitropack: '2.13.4',
  h3: '1.15.11'
};
let ok = true;
for (const [name, want] of Object.entries(framework)) {
  const got = read(name).version;
  console.log(`${got === want ? 'ok  ' : 'FAIL'} ${name} ${got} (contract ${want})`);
  ok &&= got === want;
}
for (const [name, version] of strata) console.log(`     ${name} ${version}`);
const versions = new Set(strata.map(([, v]) => v));
const rc = versions.size === 1 && /^1\.0\.0-rc\.\d+$/.test([...versions][0]);
if (!ok) {
  console.log('INVALID: framework tuple differs from the RC contract');
  process.exit(1);
}
if (rc) {
  console.log(`RC TUPLE: ${[...versions][0]}`);
  process.exit(0);
}
console.log('PRE-RC BASELINE: not the released RC. Evidence from this install is REHEARSAL ONLY.');
process.exit(2);
