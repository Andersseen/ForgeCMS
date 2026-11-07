// Starts the Cloudflare Pages build on local workerd + fresh local D1 and runs the HTTP security matrix
// against it. Usage (after `pnpm build:cloudflare`): node --experimental-strip-types qualification/workerd-http.ts
import { spawn } from 'node:child_process';

const PORT = '4630';
const root = new URL('..', import.meta.url).pathname;
const server = spawn(process.execPath, ['--experimental-strip-types', 'e2e/serve-workerd.ts'], {
  cwd: root,
  env: { ...process.env, E2E_PORT: PORT },
  stdio: 'inherit',
  detached: true
});
const stop = () => {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!up) throw new Error('workerd did not start');
  const matrix = spawn(
    process.execPath,
    ['--experimental-strip-types', 'qualification/node-production.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        EXTERNAL_BASE: `http://127.0.0.1:${PORT}`,
        QUALIFICATION_TARGET: 'workerd'
      },
      stdio: 'inherit'
    }
  );
  process.exitCode = await new Promise<number>((resolve) =>
    matrix.on('exit', (code) => resolve(code ?? 1))
  );
} finally {
  stop();
}
