const { test, expect } = require('@playwright/test');

// Third-party players add network variance and nothing these specs assert on.
test.beforeEach(async ({ page }) => {
  await page.route(/(youtube\.com|youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
});

const STORAGE_KEY = 'kiddo:voiceover:nutshell::modalVideo';
const TEST_URL = 'https://example.com/audio/dub.mp3';

test.describe('voice-over toggle', () => {
  test('every card ships a toggle, a settings gear and a hidden audio element', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const count = await page.locator('.video-card').count();
    await expect(page.locator('.video-voiceover-toggle')).toHaveCount(count);
    await expect(page.locator('.video-voiceover-settings')).toHaveCount(count);
    await expect(page.locator('.video-voiceover-audio')).toHaveCount(count);

    const first = page.locator('.video-voiceover').first();
    await expect(first.locator('.video-voiceover-toggle')).toHaveAttribute('data-mode', 'original');
    await expect(first.locator('.video-voiceover-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(first.locator('.video-voiceover-panel')).toBeHidden();
  });

  test('the gear opens and closes the settings panel', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const card = page.locator('.video-voiceover').first();
    const gear = card.locator('.video-voiceover-settings');
    const panel = card.locator('.video-voiceover-panel');

    await expect(panel).toBeHidden();
    await gear.click();
    await expect(panel).toBeVisible();
    await expect(gear).toHaveAttribute('aria-expanded', 'true');

    await gear.click();
    await expect(panel).toBeHidden();
    await expect(gear).toHaveAttribute('aria-expanded', 'false');
  });

  test('toggling with no audio configured opens the panel instead of switching', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const card = page.locator('.video-voiceover').first();
    await card.locator('.video-voiceover-toggle').click();

    await expect(card.locator('.video-voiceover-panel')).toBeVisible();
    await expect(card.locator('.video-voiceover-toggle')).toHaveAttribute('data-mode', 'original');
    await expect(card.locator('.video-voiceover-status')).toHaveClass(/is-error/);
  });

  test('saving a link switches the toggle to voice-over mode and persists it', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const card = page.locator('.video-voiceover').first();
    await card.locator('.video-voiceover-settings').click();
    await card.locator('.video-voiceover-url').fill(TEST_URL);
    await card.locator('.video-voiceover-save').click();

    await expect(card.locator('.video-voiceover-status')).not.toHaveClass(/is-error/);

    const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBe(TEST_URL);

    const toggle = card.locator('.video-voiceover-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'voiceover');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('Оруулсан дуу');

    const audioSrc = await card.locator('.video-voiceover-audio').evaluate((a) => a.src);
    expect(audioSrc).toBe(TEST_URL);

    // Toggling back returns to the original-audio label.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'original');
    await expect(toggle).toContainText('Эх дуу');
  });

  test('a saved link is restored, pre-filled, on the next visit', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [STORAGE_KEY, TEST_URL]
    );

    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const card = page.locator('.video-voiceover').first();
    await expect(card.locator('.video-voiceover-url')).toHaveValue(TEST_URL);
    await expect(card.locator('.video-voiceover-status')).not.toHaveClass(/is-error/);
    await expect(card.locator('.video-voiceover-status')).not.toBeEmpty();

    // No need to open the panel first this time: the toggle can switch right away.
    const toggle = card.locator('.video-voiceover-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'voiceover');
  });

  test('each card keeps its own voice-over independently', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const cards = page.locator('.video-voiceover');
    const first = cards.nth(0);
    const second = cards.nth(1);

    await first.locator('.video-voiceover-settings').click();
    await first.locator('.video-voiceover-url').fill(TEST_URL);
    await first.locator('.video-voiceover-save').click();
    await first.locator('.video-voiceover-toggle').click();

    await expect(first.locator('.video-voiceover-toggle')).toHaveAttribute('data-mode', 'voiceover');
    await expect(second.locator('.video-voiceover-toggle')).toHaveAttribute('data-mode', 'original');
    await expect(second.locator('.video-voiceover-panel')).toBeHidden();
  });
});
