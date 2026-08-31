const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Third-party players add network variance and nothing these specs assert on.
test.beforeEach(async ({ page }) => {
  await page.route(/(youtube\.com|youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
});

const data = (slug) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', slug + '.json'), 'utf8'));

test.describe('voice-over toggle', () => {
  test('only videos with a voiceover url in the JSON get a toggle', async ({ page }) => {
    const videos = data('nutshell').videos;
    const withVoiceover = videos.filter((v) => v.voiceover).length;

    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    await expect(page.locator('.video-card')).toHaveCount(videos.length);
    await expect(page.locator('.video-voiceover')).toHaveCount(withVoiceover);
    await expect(page.locator('.video-voiceover-toggle')).toHaveCount(withVoiceover);

    // No leftover upload/settings surface of any kind.
    await expect(page.locator('.video-voiceover-settings')).toHaveCount(0);
    await expect(page.locator('.video-voiceover-panel')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.locator('.video-voiceover-url')).toHaveCount(0);
  });

  test('the hidden audio element points straight at the JSON url', async ({ page }) => {
    const first = data('nutshell').videos[0];
    expect(first.voiceover, 'fixture must keep a voiceover url on its first video').toBeTruthy();

    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const audioSrc = await page.locator('.video-voiceover-audio').first().evaluate((a) => a.src);
    expect(audioSrc).toBe(first.voiceover);
  });

  test('the toggle starts on original audio and switches on click', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const toggle = page.locator('.video-voiceover-toggle').first();
    await expect(toggle).toHaveAttribute('data-mode', 'original');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toContainText('Эх дуу');

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'voiceover');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('Оруулсан дуу');

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'original');
    await expect(toggle).toContainText('Эх дуу');
  });

  test('each card keeps its own toggle state independently', async ({ page }) => {
    const videos = data('nutshell').videos;
    const secondHasVoiceover = !!videos[1] && !!videos[1].voiceover;
    test.skip(!secondHasVoiceover, 'fixture needs a second video with a voiceover url for this check');

    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const toggles = page.locator('.video-voiceover-toggle');
    await toggles.nth(0).click();

    await expect(toggles.nth(0)).toHaveAttribute('data-mode', 'voiceover');
    await expect(toggles.nth(1)).toHaveAttribute('data-mode', 'original');
  });

  test('the homepage renders no stray voice-over markup for videos without one', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    const total = await page.locator('.video-card').count();
    const withToggle = await page.locator('.video-voiceover-toggle').count();
    expect(withToggle).toBeLessThanOrEqual(total);
    await expect(page.locator('.video-voiceover-settings, .video-voiceover-panel, input[type="file"]')).toHaveCount(0);
  });
});
