import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('media-upload');

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(DEMO_EMAIL);
  await page.locator('input#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

// Spec 067 / roadmap D04: one browser upload lifecycle — the real multipart upload from the admin, the
// stored object served back through `handleFile` only as part of its (publicly readable) document.
test('media upload: the browser uploads a file and it is served through its document', async ({
  page,
  request
}) => {
  await signIn(page);
  await page.goto('/admin/media');

  const alt = `E2E upload ${Date.now()}`;
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG
  });
  await page.getByPlaceholder('Alt text').fill(alt);
  await page.getByRole('button', { name: 'Upload' }).click();

  const image = page.getByRole('img', { name: alt });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // The same URL, fetched without the admin session: the media collection is publicly readable.
  const src = await image.getAttribute('src');
  expect(src).toMatch(/\/api\/media\/media\//);
  const anonymous = await request.get(src!);
  expect(anonymous.status()).toBe(200);
  expect(anonymous.headers()['content-type']).toBe('image/png');

  // A key no document owns is not served, even under the media prefix.
  const stray = await request.get('/api/media/media/not-an-upload.png');
  expect(stray.status()).toBe(404);
});
