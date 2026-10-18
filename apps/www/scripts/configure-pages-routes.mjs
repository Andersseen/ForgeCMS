import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const routesPath = resolve('dist/analog/_routes.json');
const routes = JSON.parse(await readFile(routesPath, 'utf8'));
const pagesRoutesPath = resolve('dist/analog/public/_routes.json');
// Invoke the Pages Function only for the application routes that need it. The public pages are
// prerendered static files; leaving them out also lets Pages return its native 404.html response.
routes.include = ['/admin', '/admin/*', '/api/*'];
routes.exclude = [];
const contents = `${JSON.stringify(routes, null, 2)}\n`;
await writeFile(routesPath, contents);
await writeFile(pagesRoutesPath, contents);
process.stdout.write('Excluded prerendered public pages from Pages Functions\n');
