import { expect, test } from '@playwright/test';

/**
 * One atomic read of everything the theme assertion compares. Every page component (landing, demo, docs)
 * renders its own `forge-cms-header`, so a route change replaces the header element. Reading the page
 * background and the header background through two separate locators let the second read land on the
 * previous page's header just after it was detached — `getComputedStyle` of a detached node is `''`
 * (spec 089 flake inventory F1). A single in-page evaluation queries both elements at the same instant,
 * so either both are attached or the snapshot is `null` and the poll simply tries again.
 */
const themeSnapshot = () =>
  document.querySelector('.forge-header') && document.querySelector('.forge-public')
    ? {
        path: location.pathname,
        header: getComputedStyle(document.querySelector('.forge-header')!).backgroundColor,
        page: getComputedStyle(document.querySelector('.forge-public')!).backgroundColor
      }
    : null;

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} theme is consistent across Home, Demo and Docs and survives reload`, async ({
    page
  }) => {
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    await page.goto('/');
    const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    const background = mode === 'dark' ? 'rgb(23, 24, 28)' : 'rgb(246, 247, 248)';
    await page.getByRole('tab', { name: 'Content', exact: true }).click();
    await expect
      .poll(() =>
        page.locator('.forge-content-view').evaluate((el) => getComputedStyle(el).backgroundColor)
      )
      .toBe(mode === 'dark' ? 'rgb(34, 36, 42)' : 'rgb(255, 255, 255)');
    for (const [destination, path] of [
      ['Product', '/'],
      ['Demo', '/demo'],
      ['Docs', '/docs/introduction']
    ] as const) {
      await page
        .locator('.forge-header')
        .getByRole('link', { name: destination, exact: true })
        .click();
      await expect(page.getByRole('button', { name: label })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      // Arrived at the destination AND header and page share the theme, in one consistent snapshot.
      await expect
        .poll(() => page.evaluate(themeSnapshot), { message: `${destination} theme snapshot` })
        .toEqual({ path, header: background, page: background });
      await page.reload();
      await expect(page.getByRole('button', { name: label })).toBeVisible();
      // The preference survives the reload: same destination, same theme, header and page alike.
      await expect
        .poll(() => page.evaluate(themeSnapshot), { message: `${destination} after reload` })
        .toEqual({ path, header: background, page: background });
    }
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} semantic palette keeps readable contrast and brand accents`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    await page.goto('/');
    const palette = await page.locator('.forge-public').evaluate((element) => {
      const css = getComputedStyle(element);
      return Object.fromEntries(
        [
          '--background',
          '--foreground',
          '--forge-surface',
          '--forge-raised',
          '--border',
          '--muted-foreground',
          '--primary',
          '--primary-foreground',
          '--forge-cyan'
        ].map((token) => [token, css.getPropertyValue(token).trim()])
      );
    });
    expect(palette['--background']).toBe(mode === 'dark' ? '#17181c' : '#f6f7f8');
    expect(palette['--forge-surface']).not.toBe(palette['--background']);
    expect(palette['--forge-raised']).not.toBe(palette['--background']);
    expect(palette['--primary']).toBe(mode === 'dark' ? '#b39afa' : '#7646dd');
    expect(palette['--forge-cyan']).toBe(mode === 'dark' ? '#56d9e9' : '#08798a');

    const primaryFill = mode === 'dark' ? 'rgb(179, 154, 250)' : 'rgb(118, 70, 221)';
    // The prerendered link can appear before Volt applies its button classes.
    await expect(
      page.locator('.forge-header').getByRole('link', { name: 'Get started' })
    ).toHaveCSS('background-color', primaryFill);
    const buttons = await page.evaluate(() => {
      const css = (element: Element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      };
      const header = Array.from(document.querySelectorAll('.forge-header a')).find(
        (link) => link.textContent?.trim() === 'Get started'
      );
      return {
        primary: css(document.querySelector('.forge-brand-button')!),
        header: css(header!)
      };
    });
    const primaryText = mode === 'dark' ? 'rgb(33, 26, 46)' : 'rgb(255, 255, 255)';
    expect(buttons.primary).toEqual({ background: primaryFill, color: primaryText });
    expect(buttons.header).toEqual({ background: primaryFill, color: primaryText });

    const scrollbars = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const page = getComputedStyle(document.querySelector('.forge-public')!);
      return {
        viewportTrack: root.getPropertyValue('--scrollbar-track').trim(),
        viewportThumb: root.getPropertyValue('--scrollbar-thumb').trim(),
        viewportHover: root.getPropertyValue('--scrollbar-thumb-hover').trim(),
        contentTrack: page.getPropertyValue('--scrollbar-track').trim(),
        contentThumb: page.getPropertyValue('--scrollbar-thumb').trim()
      };
    });
    expect(scrollbars).toEqual({
      viewportTrack: mode === 'dark' ? '#17181c' : '#f6f7f8',
      viewportThumb: mode === 'dark' ? '#757985' : '#898f98',
      viewportHover: mode === 'dark' ? '#b39afa' : '#7646dd',
      contentTrack: mode === 'dark' ? '#22242a' : '#ffffff',
      contentThumb: mode === 'dark' ? '#757985' : '#898f98'
    });

    await page.goto('/privacy');
    await expect(page.getByRole('button', { name: 'Allow analytics' })).toHaveCSS(
      'background-color',
      primaryFill
    );

    const contrast = await page.locator('.forge-public').evaluate((element) => {
      const css = getComputedStyle(element);
      const luminance = (color: string): number => {
        const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
        const channels = hex
          ? [0, 2, 4].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
          : (color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number) ?? []);
        const linear = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
      };
      const ratio = (first: string, second: string): number => {
        const a = luminance(first);
        const b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return {
        body: ratio(css.getPropertyValue('--foreground'), css.getPropertyValue('--background')),
        secondary: ratio(
          css.getPropertyValue('--muted-foreground'),
          css.getPropertyValue('--background')
        ),
        accent: ratio(css.getPropertyValue('--primary'), css.getPropertyValue('--background')),
        button: ratio(
          css.getPropertyValue('--primary-foreground'),
          css.getPropertyValue('--primary')
        ),
        border: ratio(css.getPropertyValue('--border'), css.getPropertyValue('--background'))
      };
    });
    expect(contrast.body).toBeGreaterThanOrEqual(4.5);
    expect(contrast.secondary).toBeGreaterThanOrEqual(4.5);
    expect(contrast.accent).toBeGreaterThanOrEqual(4.5);
    expect(contrast.button).toBeGreaterThanOrEqual(4.5);
    expect(contrast.border).toBeGreaterThanOrEqual(3);
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} public pages use one primary button treatment`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    const expected = {
      background: mode === 'dark' ? 'rgb(179, 154, 250)' : 'rgb(118, 70, 221)',
      foreground: mode === 'dark' ? 'rgb(33, 26, 46)' : 'rgb(255, 255, 255)'
    };

    for (const path of ['/', '/demo', '/docs/introduction', '/privacy']) {
      await page.goto(path);
      await expect(
        page.locator('.forge-header').getByRole('link', { name: 'Get started' })
      ).toHaveCSS('background-color', expected.background);
      const buttons = await page
        .locator('.forge-public [voltButton]:not([variant])')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, foreground: style.color };
          })
        );
      expect(buttons.length, `${path} has a primary action`).toBeGreaterThan(0);
      for (const button of buttons) expect(button, `${path} primary action`).toEqual(expected);
    }
  });
}

test('theme toggle persists through navigation and a fresh page load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(await page.evaluate(() => localStorage.getItem('forgecms-theme'))).toBe('dark');
  await page.locator('.forge-header').getByRole('link', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.locator('.forge-header').getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
});

test('system theme changes apply until an explicit user choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/docs/introduction');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('invalid stored preference falls back to the system', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('forgecms-theme', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('blocked storage still allows switching and navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('Blocked');
      }
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('.forge-header').getByRole('link', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('mobile theme control is available without opening navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Mobile' })
    .getByRole('link', { name: 'Docs', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ).toBeLessThanOrEqual(1);
});

test('saved theme is applied before Angular starts', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('forgecms-theme', 'dark'));
  await page.route('**/src/main.ts', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.locator('html').evaluate((el) => el.style.colorScheme)).toBe('dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#17181C');
});
