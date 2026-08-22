const { test, expect } = require('@playwright/test');

const PREVIEW_LIMIT = 3;
const CHANNEL_PAGES = [
  'channel-nutshell.html',
  'channel-brainscoop.html',
  'channel-schooloflife.html',
];

const visible = (page, sel) =>
  page.locator(sel).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

async function signIn(page, name = 'Тест') {
  await page.addInitScript(
    (n) => {
      try {
        window.localStorage.setItem('kiddo.session', JSON.stringify({ name: n, at: Date.now() }));
      } catch (e) { /* ignore */ }
    },
    name
  );
}

test.beforeEach(async ({ page }) => {
  await page.route(/(youtube\.com|youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
});

test.describe('signed out', () => {
  test('homepage shows only the preview videos per channel', async ({ page }) => {
    await page.goto('/index.html');

    const channels = await page.locator('.post-item').count();
    expect(channels).toBe(3);

    // Every card is still in the DOM; only the first N per channel are shown.
    expect(await page.locator('.portfolio-item').count()).toBe(12);
    expect(await visible(page, '.portfolio-item')).toBe(channels * PREVIEW_LIMIT);

    for (const post of await page.locator('.post-item').all()) {
      const shown = await post
        .locator('.portfolio-item')
        .evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
      expect(shown).toBe(PREVIEW_LIMIT);
    }
  });

  test('each channel block offers a sign-in prompt for the hidden videos', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.video-locked-notice')).toHaveCount(3);
    const link = page.locator('.video-locked-notice a').first();
    await expect(link).toHaveAttribute('href', 'login.html');
  });

  test('header offers a sign-in link', async ({ page }) => {
    await page.goto('/index.html');
    const link = page.locator('.auth-nav-item a');
    await expect(link).toHaveText('Нэвтрэх');
    await expect(link).toHaveAttribute('href', 'login.html');
  });

  for (const p of CHANNEL_PAGES) {
    test(`${p} shows only the preview videos`, async ({ page }) => {
      await page.goto('/' + p);
      expect(await page.locator('.video-card').count()).toBe(4);
      await expect.poll(() => visible(page, '.video-card')).toBe(PREVIEW_LIMIT);
      await expect(page.locator('.video-locked-notice')).toHaveCount(1);
    });
  }

  test('search cannot reveal a locked video', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await expect.poll(() => visible(page, '.video-card')).toBe(PREVIEW_LIMIT);

    // "өт нүх" only matches the 4th (locked) card on this channel.
    await page.fill('#videoSearch', 'өт нүх');
    await expect(page.locator('.video-search-status')).toHaveText('Бичлэг олдсонгүй');
    await expect.poll(() => visible(page, '.video-card')).toBe(0);
  });
});

test.describe('signed in', () => {
  test('homepage shows every video and drops the prompts', async ({ page }) => {
    await signIn(page);
    await page.goto('/index.html');

    await expect.poll(() => visible(page, '.portfolio-item')).toBe(12);
    await expect(page.locator('.video-locked-notice')).toHaveCount(0);
  });

  for (const p of CHANNEL_PAGES) {
    test(`${p} shows every video`, async ({ page }) => {
      await signIn(page);
      await page.goto('/' + p);
      await expect.poll(() => visible(page, '.video-card')).toBe(4);
      await expect(page.locator('.video-locked-notice')).toHaveCount(0);
    });
  }

  test('search reaches a previously locked video', async ({ page }) => {
    await signIn(page);
    await page.goto('/channel-nutshell.html');
    await page.fill('#videoSearch', 'өт нүх');
    await expect.poll(() => visible(page, '.video-card')).toBe(1);
  });

  test('header offers sign-out, and signing out re-locks in place', async ({ page }) => {
    await signIn(page, 'Бат');
    await page.goto('/index.html');

    const link = page.locator('.auth-nav-item a');
    await expect(link).toHaveText('Гарах (Бат)');
    await expect.poll(() => visible(page, '.portfolio-item')).toBe(12);

    await link.click();

    // Signing out re-renders without a reload, so the gate must reapply.
    await expect.poll(() => visible(page, '.portfolio-item')).toBe(9);
    await expect(page.locator('.video-locked-notice')).toHaveCount(3);
    await expect(page.locator('.auth-nav-item a')).toHaveText('Нэвтрэх');
  });
});

test.describe('login page', () => {
  test('rejects empty credentials and stays signed out', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('button[type=submit]');
    await expect(page.locator('#loginError')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('kiddo.session'))).toBeNull();
  });

  test('signs in and returns to the homepage with everything unlocked', async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('#loginName', 'Бат');
    await page.fill('#loginPassword', 'nuutsug');
    await page.click('button[type=submit]');

    await page.waitForURL('**/index.html');
    await expect.poll(() => visible(page, '.portfolio-item')).toBe(12);
  });

  test('states plainly that the gate is a demo, not real protection', async ({ page }) => {
    // The caveat must stay on the page: it is the only thing telling a reader
    // the "locked" videos are still fully readable in the page source.
    await page.goto('/login.html');
    await expect(page.locator('.login-demo-note')).toBeVisible();
  });

  test('the "next" parameter cannot be used to redirect off-site', async ({ page }) => {
    await page.goto('/login.html?next=https://example.com/evil');
    await page.fill('#loginName', 'Бат');
    await page.fill('#loginPassword', 'nuutsug');
    await page.click('button[type=submit]');

    await page.waitForURL('**/*.html');
    expect(page.url()).toContain('127.0.0.1');
    expect(page.url()).toContain('index.html');
  });
});
