import { expect, test } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('localization');

test.describe('EN / ES clinic notice (spec 094)', () => {
  test('English by default, Spanish after the switch, and the draft never shows', async ({
    page
  }) => {
    await page.goto('/');
    const notice = page.getByTestId('clinic-notice');
    await expect(notice).toContainText('Free skin consultation this month');
    await expect(page.getByRole('link', { name: 'Read in English' })).toHaveAttribute(
      'aria-current',
      'true'
    );

    await page.getByRole('link', { name: 'Leer en español' }).click();
    await expect(page).toHaveURL(/lang=es/);
    await expect(notice).toContainText('Consulta de piel gratuita este mes');
    await expect(notice).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('link', { name: 'Leer en español' })).toHaveAttribute(
      'aria-current',
      'true'
    );

    // The language survives navigation, and neither language reveals the draft notice.
    await page.getByRole('link', { name: 'Treatments' }).first().click();
    await expect(page).toHaveURL(/\/services\?lang=es/);
    await expect(notice).toContainText('Consulta de piel gratuita');
    await expect(page.getByText(/Summer hours|Horario de verano/)).toHaveCount(0);
  });

  test('the API serves only declared locales and never the draft', async ({ request }) => {
    for (const locale of ['en', 'es']) {
      const response = await request.get(`/api/site/notices/${locale}`);
      expect(response.ok()).toBe(true);
      const body = JSON.stringify(await response.json());
      expect(body).not.toMatch(/Summer hours|Horario de verano|_status|draft/i);
    }
    expect((await request.get('/api/site/notices/fr')).status()).toBe(404);
  });

  test('keyboard users can reach the language switch', async ({ page }) => {
    await page.goto('/');
    const es = page.getByRole('link', { name: 'Leer en español' });
    await es.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/lang=es/);
  });
});
