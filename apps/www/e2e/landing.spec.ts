import { expect, test } from '@playwright/test';
import { CURRENT_FORGE_VERSION, FORGE_CHANNELS } from '../src/app/forge-release';

test('presents ForgeCMS as an Angular-native product', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Angular-native headless CMS/);
  await expect(
    page.getByRole('heading', { name: 'Your content. Your code. Your Angular.' })
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Schema', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'API', exact: true })).toBeVisible();
  await expect(page.getByLabel('Install command', { exact: true })).toContainText(
    '@forge-cms/runtime'
  );
});

test('global navigation gives Product, Demo and Docs equal routes', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('.forge-header');
  await expect(header.getByRole('link', { name: 'Product', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/#product$')
  );
  await expect(header.getByRole('link', { name: 'Demo', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(header.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/docs$')
  );
  await expect(header.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/Andersseen/ForgeCMS'
  );
});

test('primary actions route to the guide and the first-class demo page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Start building' })).toHaveAttribute(
    'href',
    new RegExp('/docs/small-project-guide$')
  );
  await expect(page.getByRole('link', { name: 'Explore the live demo' })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Explore the live demo' }).click();
  await expect(page).toHaveURL(new RegExp('/demo$'));
  await expect(
    page.getByRole('heading', { name: /Lumea is a clinic built from content/ })
  ).toBeVisible();
});

test('packages derive from the single release version', async ({ page }) => {
  await page.goto('/');

  const packages = page.locator('#packages');
  await expect(packages.getByText('@forge-cms/core', { exact: true })).toBeVisible();
  await expect(packages.getByText('@forge-cms/testing', { exact: true })).toBeVisible();
  await expect(packages.getByText('@forge-cms/s3', { exact: true })).toBeVisible();
  await expect(packages.getByText('@forge-cms/agent', { exact: true })).toBeVisible();
  await expect(packages.getByText(/Ten focused packages/)).toHaveCount(0);
  await expect(packages.getByText(/Twelve focused packages/)).toBeVisible();
  // Eleven stable packages share the stable line; the experimental agent never claims it.
  await expect(packages.locator('volt-badge', { hasText: CURRENT_FORGE_VERSION })).toHaveCount(11);
  await expect(page.getByText('0.0.0')).toHaveCount(0);
});

test('the homepage groups what 1.0 gives you and keeps the Local API story', async ({ page }) => {
  await page.goto('/');

  const architecture = page.locator('#architecture');
  for (const group of ['Content', 'Backend', 'Angular', 'Operations'])
    await expect(architecture.getByRole('heading', { name: group, exact: true })).toBeVisible();
  await expect(architecture.getByText('Reviewed, atomic migrations')).toBeVisible();
  // The Local API panel moved into the story's Runtime stage (spec 097).
  const runtime = page.locator('#story-runtime');
  await expect(runtime).toContainText('runtime.find(');
  await expect(runtime.getByRole('link', { name: /Local API guide/ })).toHaveAttribute(
    'href',
    new RegExp('/docs/local-api$')
  );
});

/** Which story stage is active and how present every stage is, in one atomic read. */
const storySnapshot = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.forge-story-step')).map((step) => ({
    stage: step.dataset['stage'],
    active: step.dataset['active'] === 'true',
    opacity: Number(getComputedStyle(step).opacity)
  }));

test('desktop story: scrolling walks Schema → Deploy and the index follows', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const index = page.getByRole('navigation', { name: 'Story stages' });
  await expect(index).toBeVisible();

  for (const [i, stage] of ['schema', 'runtime', 'angular', 'admin', 'deploy'].entries()) {
    // Native scrolling only: put the stage just past the reading line (half the viewport).
    await page.evaluate((id) => {
      const step = document.getElementById(`story-${id}`)!;
      window.scrollTo(0, step.getBoundingClientRect().top + window.scrollY - 300);
    }, stage);
    await expect
      .poll(async () => (await page.evaluate(storySnapshot)).find((s) => s.active)?.stage)
      .toBe(stage);
    await expect(index.getByRole('link').nth(i)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator(`#story-${stage} h3`)).toBeInViewport();
  }
  // The final stage settles fully present; the earlier ones recede but stay readable.
  await expect
    .poll(async () => (await page.evaluate(storySnapshot)).map((s) => s.opacity))
    .toEqual([0.55, 0.55, 0.55, 0.55, 1]);
  await expect(page.locator('#story-deploy')).toContainText('libSQL');
  // The sticky index releases at the end of the section instead of covering what follows.
  await page.locator('#capabilities').scrollIntoViewIfNeeded();
  await expect(index).not.toBeInViewport();
  expect(problems).toEqual([]);
});

test('keyboard focus inside a receding stage brings it fully forward', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#story-schema').scrollIntoViewIfNeeded();
  await page.locator('#story-runtime .forge-story-code').focus();
  await expect.poll(async () => (await page.evaluate(storySnapshot))[1]?.opacity).toBe(1);
});

test('mobile story is a plain readable flow with no sticky index', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Story stages' })).toBeHidden();
  for (const stage of ['schema', 'runtime', 'angular', 'admin', 'deploy']) {
    const step = page.locator(`#story-${stage}`);
    await step.scrollIntoViewIfNeeded();
    await expect(step.locator('h3')).toBeVisible();
  }
  // No stage is ever dimmed below lg, wherever the reader is.
  expect((await page.evaluate(storySnapshot)).map((s) => s.opacity)).toEqual([1, 1, 1, 1, 1]);
  // Nothing traps scrolling: the page keeps going past the story.
  await page.locator('#packages').scrollIntoViewIfNeeded();
  await expect(page.locator('#packages')).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(1);
});

test('reduced motion: every stage and revealed element is readable without scrolling to it', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#story-admin').scrollIntoViewIfNeeded();
  expect((await page.evaluate(storySnapshot)).map((s) => s.opacity)).toEqual([1, 1, 1, 1, 1]);
  // Nothing waits for an animation: content far below the fold is already fully opaque.
  const hidden = await page.evaluate(
    () =>
      Array.from(
        document.querySelectorAll(
          '.forge-story-panel, .forge-bento-card, .forge-terminal-row, .forge-dash-bars span'
        )
      ).filter((el) => getComputedStyle(el).opacity !== '1').length
  );
  expect(hidden).toBe(0);
  await page.getByRole('link', { name: 'Explore Lumea demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test('swap, localization and analytics respond to the user, never on their own', async ({
  page
}) => {
  await page.goto('/');
  const swap = page.locator('#client-site');
  await expect(swap.getByRole('tabpanel')).toContainText("slug: 'services'");
  await swap.getByRole('tab', { name: 'Publish', exact: true }).click();
  await expect(swap.locator('.forge-swap-stage')).toHaveClass(/is-client-first/);
  await expect(swap.getByRole('tabpanel')).toContainText('Skin consultation');
  await expect(swap).toContainText('not a page builder');

  const l10n = page.locator('#localization');
  const editor = l10n.getByRole('group', { name: /Notices/ });
  await expect(editor).toContainText('Tratamientos faciales');
  await l10n.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(l10n.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(editor).toContainText('Facial treatments');
  // Both stored values stay visible regardless of the switch.
  await expect(l10n.getByRole('table')).toContainText('Tratamientos faciales');

  const analytics = page.locator('#analytics');
  await expect(analytics).toContainText('Illustrative preview · not live data');
  await expect(analytics).toContainText('1,284');
  await analytics.getByRole('button', { name: '30d', exact: true }).click();
  await expect(analytics).toContainText('5,310');
  await expect(analytics).toContainText('vs previous 30d');
});

test('the Agent Kit terminal shows the one-command init as a labelled candidate workflow', async ({
  page
}) => {
  await page.goto('/');
  const agent = page.locator('#agent-kit');
  const terminal = agent.getByRole('figure');
  await expect(terminal).toContainText('pnpm exec forge-cms-agent init');
  await expect(terminal).toContainText('8 ForgeCMS skills installed');
  await expect(terminal).toContainText('forge_project_detect');
  await expect(terminal).toContainText('Illustrative');
  if (!FORGE_CHANNELS.agentPublished) await expect(terminal).toContainText('not on npm yet');
});

/** WCAG contrast ratio of an element's text against its first opaque ancestor background. */
const contrastOf = (selector: string) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  let bg: number[] | null = null;
  for (let node: Element | null = el; node && !bg; node = node.parentElement) {
    const c = parse(getComputedStyle(node).backgroundColor);
    if (c.length >= 3 && (c[3] ?? 1) === 1) bg = c;
  }
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(bg ?? [255, 255, 255])];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

for (const mode of ['light', 'dark'] as const) {
  test(`new sections keep readable contrast in ${mode} mode`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark).*$/);
    for (const selector of [
      '#story-runtime h3',
      '.forge-story-body',
      '.forge-bento-card h3',
      '.forge-bento-card > p',
      '.forge-swap-input',
      '.forge-l10n-value',
      '.forge-terminal-prompt',
      '.forge-terminal-detail',
      '.forge-dash-value',
      '.forge-dash-label'
    ]) {
      // Polled: the element exists once the landing page has rendered (null until then).
      await expect
        .poll(() => page.evaluate(contrastOf, selector), { message: `${selector} in ${mode}` })
        .toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('stable core is not labelled experimental; Agent Kit and Analytics are', async ({ page }) => {
  await page.goto('/');

  // The hero names the core a 1.0 candidate at the stable version, not "Experimental".
  const hero = page.locator('#product');
  await expect(hero.locator('volt-badge').first()).toContainText('1.0 candidate');
  await expect(hero.locator('volt-badge').first()).toContainText(CURRENT_FORGE_VERSION);
  await expect(hero.locator('volt-badge').first()).not.toContainText('Experimental');

  for (const id of ['agent-kit', 'analytics']) {
    const section = page.locator(`#${id}`);
    await expect(section.locator('.forge-experimental-badge').first()).toHaveText('Experimental');
  }
  // Nothing in the stable sections wears the badge.
  for (const id of ['architecture', 'localization'])
    await expect(page.locator(`#${id} .forge-experimental-badge`)).toHaveCount(0);
});

test('Agent Kit availability follows registry truth and links to its docs', async ({ page }) => {
  await page.goto('/');

  const agent = page.locator('#agent-kit');
  await expect(agent.getByRole('link', { name: 'Read Agent Kit docs' })).toHaveAttribute(
    'href',
    new RegExp('/docs/agent-kit$')
  );
  await expect(agent).toContainText('read-only');
  await expect(agent).toContainText('No telemetry');
  if (FORGE_CHANNELS.agentPublished) {
    await expect(agent.getByLabel('Agent Kit install command')).toContainText('@forge-cms/agent');
  } else {
    await expect(agent.getByText('Coming with the 1.0 release candidate')).toBeVisible();
    // No working-looking install command for a package that is not on the registry.
    await expect(agent.getByLabel('Agent Kit install command')).toHaveCount(0);
    await expect(page.getByText(/pnpm add[^\n]*@forge-cms\/agent/)).toHaveCount(0);
  }
});

test('Analytics shows only metrics that exist and states the privacy contract', async ({
  page
}) => {
  await page.goto('/');

  const analytics = page.locator('#analytics');
  await expect(analytics.getByRole('link', { name: 'Analytics docs' })).toHaveAttribute(
    'href',
    new RegExp('/docs/analytics$')
  );
  await expect(analytics).toContainText('Pageviews');
  await expect(analytics).toContainText('Top pages');
  await expect(analytics).toContainText('No persistent tracking cookie');
  await expect(analytics).toContainText('Referrer host only');
  await expect(analytics).not.toContainText(/unique visitors|sessions|funnel|heatmap/i);
});

test('localization example is truthful about what is supported', async ({ page }) => {
  await page.goto('/');

  const localization = page.locator('#localization');
  await expect(localization).toContainText('Facial treatments');
  await expect(localization).toContainText('Tratamientos faciales');
  await expect(localization).toContainText('text and textarea');
  await expect(localization).toContainText('not localized in 1.0');
  await expect(localization.getByRole('link', { name: /Localization guide/ })).toHaveAttribute(
    'href',
    new RegExp('/docs/collections$')
  );
});

test('the roadmap never claims 1.0 is released', async ({ page }) => {
  await page.goto('/');

  const roadmap = page.locator('#roadmap');
  await expect(roadmap.getByText('0.6', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('0.9', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('1.0', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('Reviewed migrations')).toBeVisible();
  await expect(roadmap.getByText('Upgrade and backup/restore rehearsal')).toBeVisible();
  await expect(roadmap).toContainText('not a released 1.0');
  await expect(page.getByText(/1\.0 (is )?released|now available/i)).toHaveCount(0);
});

test('reaches agent, analytics and upgrade docs from the footer', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Agent Kit' })).toHaveAttribute(
    'href',
    new RegExp('/docs/agent-kit$')
  );
  await expect(footer.getByRole('link', { name: 'Analytics' })).toHaveAttribute(
    'href',
    new RegExp('/docs/analytics$')
  );
});

test('the new sections do not overflow at 390, 768, 1440 and 1920', async ({ page }) => {
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#analytics')).toBeAttached();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('mobile navigation remains usable and the page does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const mobile = page.getByRole('navigation', { name: 'Mobile' });
  await expect(mobile.getByRole('link', { name: 'Product' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: 'Demo' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: 'Docs' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: /GitHub/ })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('footer keeps the project destinations available', async ({ page }) => {
  await page.goto('/');

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'ForgeCMS' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Demo' })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    new RegExp('/docs$')
  );
  await expect(footer.getByRole('link', { name: 'npm' })).toHaveAttribute(
    'href',
    'https://www.npmjs.com/org/forge-cms'
  );
});

test('showcase connects the schema, content and API without a mutation', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
      mutations.push(request.url());
  });
  await page.goto('/');
  const schema = page.getByRole('tab', { name: 'Schema', exact: true });
  const content = page.getByRole('tab', { name: 'Content', exact: true });
  const api = page.getByRole('tab', { name: 'API', exact: true });
  await expect(schema).toHaveAttribute('aria-selected', 'true');
  const schemaPanel = page.locator('.forge-showcase').getByRole('tabpanel');
  await expect(schemaPanel).toHaveAttribute(
    'id',
    (await schema.getAttribute('aria-controls')) ?? ''
  );
  await expect(schemaPanel).toContainText('defineCollection');
  await schema.focus();
  await page.keyboard.press('ArrowRight');
  await expect(content).toBeFocused();
  await expect(content).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.forge-showcase').getByRole('tabpanel')).toContainText(
    'A home for your next idea'
  );
  await expect(page.locator('.forge-showcase').getByRole('tabpanel')).toContainText(
    'a-home-for-your-next-idea'
  );
  await page.keyboard.press('End');
  await expect(api).toBeFocused();
  await expect(page.locator('.forge-showcase').getByRole('tabpanel')).toContainText('"data"');
  await expect(page.locator('.forge-showcase').getByRole('tabpanel')).toContainText(
    'a-home-for-your-next-idea'
  );
  await page.keyboard.press('Home');
  await expect(schema).toBeFocused();
  await expect(schema).toHaveAttribute('aria-selected', 'true');
  expect(mutations).toEqual([]);
});

test('copy command reports success and provides a fallback on clipboard denial', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          sessionStorage.setItem('copied-command', text);
          return Promise.resolve();
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Copy install command' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied');
  expect(await page.evaluate(() => sessionStorage.getItem('copied-command'))).toContain(
    '@forge-cms/runtime'
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied')) }
    });
  });
  await page.getByRole('button', { name: 'Copy install command' }).click();
  await expect(page.getByRole('status')).toHaveText('Select and copy the command');
  await expect(page.getByLabel('Install command', { exact: true })).toBeVisible();
});

test('mobile menu closes on Escape and navigation, and restores focus on Escape', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Toggle navigation' });
  await trigger.click();
  await page
    .getByRole('navigation', { name: 'Mobile' })
    .getByRole('link', { name: 'Demo', exact: true })
    .focus();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page
    .getByRole('navigation', { name: 'Mobile' })
    .getByRole('link', { name: 'Product', exact: true })
    .click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('skip link reaches the single main landmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('main')).toHaveCount(1);
});

/** Opacity of the showcase and its view, and whether every running animation is effectively instant. */
const showcaseSnapshot = () => {
  const showcase = document.querySelector('.forge-showcase');
  const view = document.querySelector('.forge-showcase-view');
  if (!showcase || !view) return null;
  return {
    showcaseOpacity: getComputedStyle(showcase).opacity,
    viewOpacity: getComputedStyle(view).opacity,
    animationsAreInstant: view
      .getAnimations()
      .every((animation) => Number(animation.effect?.getTiming().duration ?? 0) <= 1)
  };
};

for (const width of [390, 768, 1440, 1920]) {
  test(`all showcase views fit at ${width}px with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    for (const name of ['Schema', 'Content', 'API']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.locator('.forge-showcase').getByRole('tabpanel')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(1);
      // One atomic read of everything compared: switching a tab replaces the view element, and a node read
      // through a separate locator after that is detached — `getComputedStyle` of it is `''` (spec 089 F3).
      await expect
        .poll(() => page.evaluate(showcaseSnapshot), { message: `${name} showcase at ${width}px` })
        .toEqual({ showcaseOpacity: '1', viewOpacity: '1', animationsAreInstant: true });
    }
  });
}

test('the roadmap track scrolls natively to the 1.0 destination card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const roadmap = page.locator('#roadmap');
  const track = roadmap.getByRole('list', { name: 'Roadmap milestones' });
  const previous = roadmap.getByRole('button', { name: 'Previous milestones' });
  const next = roadmap.getByRole('button', { name: 'Next milestones' });
  await track.scrollIntoViewIfNeeded();
  await expect(previous).toBeDisabled();
  // Every milestone is in the DOM and in order, whatever the scroll position.
  await expect(track.locator('.forge-milestone-version')).toHaveText([
    '0.6',
    '0.7',
    '0.8',
    '0.9',
    '0.10',
    '0.11',
    '0.12',
    '1.0'
  ]);
  const destination = track.locator('[data-status="next"]');
  await expect(destination).toContainText('1.0 candidate certified');
  if (!FORGE_CHANNELS.rcPublished) await expect(destination).toContainText('Public RC next');
  // Page until the end: each click scrolls instantly (reduced motion), then the edge state settles.
  await expect(async () => {
    if (await next.isEnabled()) await next.click({ timeout: 1000 });
    await expect(next).toBeDisabled({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(destination).toBeInViewport();
  await expect(previous).toBeEnabled();
  // The track is a focusable scroll region, so keyboard users can scroll it too.
  await track.focus();
  await expect(track).toBeFocused();
});
