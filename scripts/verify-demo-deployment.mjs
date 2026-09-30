import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://forge-cms-demo.pages.dev/api/status';

export function isHealthyDemoStatus(value) {
  if (typeof value !== 'object' || value === null) return false;
  const data = value.data;
  if (typeof data !== 'object' || data === null) return false;
  return (
    typeof data.database === 'string' &&
    data.database.length > 0 &&
    typeof data.auth === 'string' &&
    data.auth.length > 0 &&
    typeof data.storage === 'string' &&
    data.storage.length > 0 &&
    typeof data.collections === 'object' &&
    data.collections !== null &&
    Object.values(data.collections).every(
      (count) => typeof count === 'number' && Number.isFinite(count) && count >= 0
    )
  );
}

export async function verifyDemoDeployment({
  url = DEFAULT_URL,
  attempts = 12,
  delayMs = 5_000,
  fetchImpl = fetch
} = {}) {
  let lastFailure = 'No request was made.';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        const body = await response.json();
        if (isHealthyDemoStatus(body)) {
          console.log(`Demo health check passed on attempt ${attempt}.`);
          return;
        }
        lastFailure = 'The endpoint returned 200 with an invalid health payload.';
      } else {
        lastFailure = `The endpoint returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    console.error(`Demo health check attempt ${attempt}/${attempts} failed: ${lastFailure}`);
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Demo deployment did not become healthy. ${lastFailure}`);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  await verifyDemoDeployment({
    ...(process.env.DEMO_HEALTH_URL !== undefined && { url: process.env.DEMO_HEALTH_URL }),
    ...(process.env.DEMO_HEALTH_ATTEMPTS !== undefined && {
      attempts: Number(process.env.DEMO_HEALTH_ATTEMPTS)
    })
  });
}
