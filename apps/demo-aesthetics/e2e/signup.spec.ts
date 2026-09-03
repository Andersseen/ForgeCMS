import { expect, test } from '@playwright/test';

/**
 * `apps/demo-aesthetics` has no signup UI (spec 054 non-goals — this app doesn't dogfood the reusable
 * `ForgeSignUpComponent`), so this exercises the real server primitive at the request level instead of
 * a UI journey. Only runs with `FORGE_ENABLE_SIGNUP=1` set on the dev server (see `playwright.config.ts`)
 * — the real deployed demo never sets this, matching spec 054 §7's "opt-in, never live by default".
 */
test.describe('signup (FORGE_ENABLE_SIGNUP=1)', () => {
  test('signup creates a viewer, sets a session cookie, and never accepts a role field', async ({
    page
  }) => {
    const email = `e2e-signup-${Date.now()}@example.com`;

    const response = await page.request.post('/api/auth/signup', {
      data: { email, password: 'longenoughpassword', name: 'E2E Signup', role: 'admin' },
      headers: { 'content-type': 'application/json' }
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.user.email).toBe(email);
    // The crafted `role: 'admin'` in the request body above is silently ignored — handleSignup never
    // reads it — not merely overridden after the fact.
    expect(body.data.user.role).toBe('viewer');

    // The cookie the response set actually authenticates a follow-up request.
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const meBody = await me.json();
    expect(meBody.data.email).toBe(email);
  });

  test('a duplicate email is rejected with a real message, not a generic failure', async ({
    page
  }) => {
    const email = `e2e-dup-${Date.now()}@example.com`;
    const first = await page.request.post('/api/auth/signup', {
      data: { email, password: 'longenoughpassword' },
      headers: { 'content-type': 'application/json' }
    });
    expect(first.status()).toBe(201);

    const second = await page.request.post('/api/auth/signup', {
      data: { email, password: 'anotherlongpassword' },
      headers: { 'content-type': 'application/json' }
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.error.message).toBe('Email is already in use');
  });
});

// "Disabled by default" itself isn't re-proven here — this project's playwright.config.ts always sets
// FORGE_ENABLE_SIGNUP=1 for its webServer, so there's no "disabled" server instance in this run to
// assert against. That contract is covered where it can actually be exercised: packages/runtime's
// handleSignup unit tests (404 when `enabled: false`) and this app's real deploy simply never setting
// the env var in the first place.
