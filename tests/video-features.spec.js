const { test, expect } = require('@playwright/test');

const CHANNELS = [
  { page: 'channel-nutshell.html', name: 'Kurzgesagt – In a Nutshell' },
  { page: 'channel-brainscoop.html', name: 'The Brain Scoop' },
  { page: 'channel-schooloflife.html', name: 'The School of Life' },
];

// Third-party players are irrelevant to these assertions and add network
// variance; block them so the specs test our markup only.
//
// These specs cover the full catalogue, so they run signed in — the sign-in
// gate itself is covered separately in auth-gate.spec.js. Seeding the session
// via addInitScript makes it present before the page's own scripts run.
test.beforeEach(async ({ page }) => {
  await page.route(/(youtube\.com|youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'kiddo.session',
        JSON.stringify({ name: 'Тест', at: Date.now() })
      );
    } catch (e) { /* storage unavailable — the gate test covers that path */ }
  });
});

test.describe('keyword search', () => {
  // Count what is actually rendered rather than probing a specific mechanism:
  // visibility is driven by classes (.is-locked / .is-filtered), not inline styles.
  const visible = (page, sel) =>
    page.locator(sel).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

  test('search field and magnifier icon are rendered and visible', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#videoSearch')).toBeVisible();

    const icon = page.locator('.video-search-icon');
    await expect(icon).toBeVisible();

    // The magnifier must be clearly shown, not a hairline or a collapsed box.
    const box = await icon.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(16);
    expect(box.height).toBeGreaterThanOrEqual(16);
    const strokeWidth = await icon.evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
    expect(strokeWidth).toBeGreaterThanOrEqual(1.5);
    const opacity = await icon.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThanOrEqual(0.8);
  });

  test('filters cards by keyword and reports the match count', async ({ page }) => {
    await page.goto('/index.html');
    const total = await page.locator('.portfolio-item').count();
    expect(total).toBeGreaterThan(0);
    expect(await visible(page, '.portfolio-item')).toBe(total);

    await page.fill('#videoSearch', 'хар нүх');
    await expect(page.locator('.video-search-status')).toContainText('бичлэг олдлоо');
    await expect.poll(() => visible(page, '.portfolio-item')).toBeLessThan(total);
    expect(await visible(page, '.portfolio-item')).toBeGreaterThan(0);
  });

  test('reports an empty state and the clear button restores every card', async ({ page }) => {
    await page.goto('/index.html');
    const total = await page.locator('.portfolio-item').count();

    await page.fill('#videoSearch', 'zzzxxqq');
    await expect(page.locator('.video-search-status')).toHaveText('Бичлэг олдсонгүй');
    // The filter is debounced, so poll rather than reading straight after fill.
    await expect.poll(() => visible(page, '.portfolio-item')).toBe(0);

    await page.locator('.video-search-clear').click();
    await expect.poll(() => visible(page, '.portfolio-item')).toBe(total);
    await expect(page.locator('#videoSearch')).toHaveValue('');
  });
});

test.describe('per-channel pages', () => {
  test('every channel has a working "all episodes" button on the homepage', async ({ page }) => {
    await page.goto('/index.html');
    const buttons = page.locator('a.btn-channel-more');
    await expect(buttons).toHaveCount(CHANNELS.length);

    const hrefs = await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs.sort()).toEqual(CHANNELS.map((c) => c.page).sort());
  });

  for (const ch of CHANNELS) {
    test(`${ch.page} loads its own videos and search`, async ({ page }) => {
      const res = await page.goto('/' + ch.page);
      expect(res.status()).toBe(200);

      await expect(page.locator('.channel-hero-title')).toHaveText(ch.name);
      await expect(page.locator('.video-card')).toHaveCount(4);
      await expect(page.locator('#videoSearch')).toBeVisible();
      await expect(page.locator('.video-search-icon')).toBeVisible();

      // Every card carries a Mongolian title and a non-trivial description.
      const summaries = await page.locator('.video-card-summary').allTextContents();
      expect(summaries).toHaveLength(4);
      for (const s of summaries) expect(s.trim().length).toBeGreaterThan(80);
    });
  }

  test('channel page search narrows the grid', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    const visible = () =>
      page.locator('.video-card').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

    await expect.poll(visible).toBe(4);
    await page.fill('#videoSearch', 'өт нүх');
    // The filter is debounced, so poll rather than reading straight after fill.
    await expect.poll(visible).toBe(1);
  });
});

test.describe('video copy', () => {
  const PLACEHOLDERS = [
    'Documentary about Dinosaur',
    'Check out our latest',
    'In this Documentary',
  ];

  for (const p of ['index.html', ...CHANNELS.map((c) => c.page)]) {
    test(`${p} has no leftover English template copy`, async ({ page }) => {
      await page.goto('/' + p);
      const body = await page.locator('body').innerText();
      const found = PLACEHOLDERS.filter((ph) => body.includes(ph));
      expect(found, `Template placeholder text still on the page: ${found.join(', ')}`).toEqual([]);
    });
  }

  test('every homepage video modal has a filled-in Mongolian summary', async ({ page }) => {
    await page.goto('/index.html');
    const summaries = await page
      .locator('.portfolio-description .col-width-12 h5')
      .allTextContents();

    expect(summaries.length).toBe(12);
    for (const s of summaries) {
      const t = s.trim();
      expect(t.length).toBeGreaterThan(80);
      // Cyrillic check: the copy must actually be Mongolian, not English.
      expect(t).toMatch(/[Ѐ-ӿ]/);
      expect(t).not.toMatch(/[A-Za-z]{6,}/);
    }
  });
});
