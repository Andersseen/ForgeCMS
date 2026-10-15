import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Spec 098 — the shared public demo (`FORGE_PUBLIC_DEMO=1`). Visitors can still experience editing and
 * publishing, and cannot turn the deployment into somebody else's database. Each test uses its own
 * client address (`x-forwarded-for`) so the per-IP limiter never couples tests; the global budget is
 * shared on purpose, and the last test spends it.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'demo@lumea.clinic', password: 'lumea-demo' };

// `origin` satisfies the runtime's same-site check, as a browser's own request would.
const as = (name: string) => ({
  'x-forwarded-for': `public-e2e-${name}`,
  origin: 'http://127.0.0.1:5175'
});

async function login(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post('/api/auth/login', {
    headers: as(name),
    data: ADMIN
  });
  expect(response.ok(), 'published demo credentials sign in').toBe(true);
}

async function signInUi(page: Page, name: string): Promise<void> {
  await page.setExtraHTTPHeaders(as(name));
  await page.goto('/login');
  await page.locator('input#email').fill(ADMIN.email);
  await page.locator('input#password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

test('policy endpoint reports the public mode and a read-only summary', async ({ request }) => {
  const body = (await (await request.get('/api/demo-policy')).json()) as {
    data: { mode: string; editable: string[]; restricted: string[] };
  };
  expect(body.data.mode).toBe('public');
  expect(body.data.editable.join(' ')).toMatch(/notices/i);
  expect(body.data.restricted.join(' ')).toMatch(/upload/i);
  const status = (await (await request.get('/api/status')).json()) as {
    data: Record<string, unknown>;
  };
  expect(status.data).toMatchObject({ mode: 'public', seeded: true });
  expect(status.data).not.toHaveProperty('collections');
});

test('a visitor signs in, sees why the demo is limited, and is told about uploads up front', async ({
  page
}) => {
  await signInUi(page, 'ui');
  const notice = page.locator('[data-demo-notice]');
  await expect(notice).toContainText('Shared demo');
  await expect(notice).toContainText('your own project');

  await page.goto('/admin/media');
  await expect(page.locator('[data-uploads-disabled]')).toContainText('Uploads are disabled');
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test('editing a localized notice in EN and ES publishes to the public site', async ({
  request
}) => {
  await login(request, 'notice');
  const list = (await (await request.get('/api/v1/notices?limit=10')).json()) as {
    data: { id: string; _status?: string }[];
  };
  const published = list.data.find((n) => n._status === 'published') ?? list.data[0];
  expect(published).toBeDefined();
  const id = String(published?.id);
  const stamp = Date.now();

  for (const locale of ['en', 'es']) {
    const response = await request.put(`/api/v1/notices/${id}?locale=${locale}`, {
      headers: as('notice'),
      data: { title: `Edited ${locale} ${stamp}`, _status: 'published' }
    });
    expect(response.ok(), `PUT ${locale}: ${response.status()} ${await response.text()}`).toBe(
      true
    );
  }

  for (const locale of ['en', 'es']) {
    const body = JSON.stringify(await (await request.get(`/api/site/notices/${locale}`)).json());
    expect(body).toContain(`Edited ${locale} ${stamp}`);
  }
});

test('a notice link cannot leave the site', async ({ request }) => {
  await login(request, 'link');
  const list = (await (await request.get('/api/v1/notices?limit=10')).json()) as {
    data: { id: string }[];
  };
  const response = await request.put(`/api/v1/notices/${list.data[0]?.id}`, {
    headers: as('link'),
    data: { linkPath: 'https://evil.example' }
  });
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { data: { linkPath: string } }).data.linkPath).toBe(
    '/booking'
  );
});

test('everything outside the allowlist is refused with a stable code', async ({ request }) => {
  await login(request, 'deny');
  const headers = as('deny');
  const services = (await (await request.get('/api/v1/services?limit=1')).json()) as {
    data: { id: string }[];
  };
  const serviceId = services.data[0]?.id;

  const cases: [string, () => Promise<{ status(): number; json(): Promise<unknown> }>, string][] = [
    [
      'delete a service',
      () => request.delete(`/api/v1/services/${serviceId}`, { headers }),
      'demo_delete_disabled'
    ],
    [
      'create a service',
      () => request.post('/api/v1/services', { headers, data: { name: 'x' } }),
      'demo_create_disabled'
    ],
    [
      'create a notice',
      () => request.post('/api/v1/notices', { headers, data: { title: 'x' } }),
      'demo_create_disabled'
    ],
    [
      'edit a service',
      () => request.put(`/api/v1/services/${serviceId}`, { headers, data: { name: 'Hacked' } }),
      'demo_read_only'
    ],
    [
      'edit site settings',
      () => request.put('/api/v1/site_settings/x', { headers, data: { clinicName: 'Hacked' } }),
      'demo_read_only'
    ],
    [
      'upload a file',
      () =>
        request.post('/api/v1/media', {
          headers,
          multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') } }
        }),
      'demo_uploads_disabled'
    ],
    [
      'sign up',
      () => request.post('/api/auth/signup', { headers, data: { ...ADMIN, email: 'n@x.dev' } }),
      'demo_accounts_disabled'
    ],
    [
      'create a user',
      () => request.post('/api/auth/users', { headers, data: ADMIN }),
      'demo_accounts_disabled'
    ]
  ];

  for (const [label, call, code] of cases) {
    const response = await call();
    expect(response.status(), label).toBe(403);
    expect(JSON.stringify(await response.json()), label).toContain(code);
  }

  // Nothing was harmed.
  const settings = (await (await request.get('/api/site/settings')).json()) as {
    data: { clinicName: string };
  };
  expect(settings.data.clinicName).not.toBe('Hacked');
  const after = (await (await request.get(`/api/v1/services/${serviceId}`)).json()) as {
    data: { id: string };
  };
  expect(after.data.id).toBe(serviceId);
});

test('an oversized body is refused before it is read', async ({ request }) => {
  await login(request, 'big');
  const list = (await (await request.get('/api/v1/notices?limit=1')).json()) as {
    data: { id: string }[];
  };
  const response = await request.put(`/api/v1/notices/${list.data[0]?.id}`, {
    headers: as('big'),
    data: { title: 'x'.repeat(40_000) }
  });
  expect(response.status()).toBe(413);
});

test('the shared booking budget fails closed, predictably, and browsing keeps working', async ({
  request
}) => {
  // Distinct clients, each under its own limit: only the global daily budget can stop this. Empty
  // bodies spend the budget without storing bookings.
  let refused: { status(): number; json(): Promise<unknown> } | undefined;
  for (let i = 0; i < 60 && !refused; i += 1) {
    const response = await request.post('/api/site/bookings', {
      headers: as(`booking-${i}`),
      data: {}
    });
    if (response.status() === 429) refused = response;
    else expect(response.status()).toBe(400);
  }
  expect(refused, 'the budget must run out').toBeDefined();
  // The dev server adds a stack trace to error bodies; a deployed build does not. Judge what the
  // demo itself says.
  const { data, statusMessage } = (await refused?.json()) as {
    data: { code: string };
    statusMessage: string;
  };
  expect(data.code).toBe('demo_budget_exhausted');
  expect(statusMessage).not.toMatch(/cloudflare|d1|r2|billing|quota/i);

  // Reads and the other classes are unaffected.
  expect((await request.get('/api/site/home')).ok()).toBe(true);
  expect((await request.get('/api/site/notices/en')).ok()).toBe(true);
  await login(request, 'after-budget');
  const policy = (await (await request.get('/api/demo-policy')).json()) as {
    data: { remaining?: { BOOKING_CREATE?: number } };
  };
  expect(policy.data.remaining?.BOOKING_CREATE ?? 0).toBe(0);
});
