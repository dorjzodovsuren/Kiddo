const { test, expect } = require('@playwright/test');

test.describe('homepage smoke test', () => {
  test('loads without uncaught script errors and renders core sections', async ({ page }) => {
    // Uncaught JS exceptions only. Console 'error' noise from third-party embeds
    // (video CDN, Twitter widget, remote slider images) is out of this repo's
    // control and out of scope here; same-origin asset/link integrity is covered
    // separately in links.spec.js.
    const pageErrors = [];
    page.on('pageerror', (err) => {
      const text = String(err);
      // Benign browser-level race: the slider's background <video> gets pause()'d
      // while its play() promise is still pending (a well-known Chromium quirk,
      // see the linked bug), not an application error.
      if (text.includes('The play() request was interrupted by a call to pause()')) return;
      pageErrors.push(text);
    });

    await page.goto('/index.html');

    await expect(page.locator('#header')).toBeVisible();
    await expect(page.locator('#logo')).toBeVisible();
    await expect(page.locator('#mainMenu')).toBeAttached();
    await expect(page.locator('#slider')).toBeAttached();

    expect(pageErrors, `Unexpected uncaught JS errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('main navigation links are present', async ({ page }) => {
    await page.goto('/index.html');
    const nav = page.locator('#mainMenu nav');
    await expect(nav.getByRole('link', { name: 'Үндсэн хуудас' })).toBeAttached();
    await expect(nav.getByText('Бичлэгүүд')).toBeAttached();
  });

  test('mobile menu trigger opens and closes the nav', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto('/index.html');

    const trigger = page.locator('#mainMenu-trigger a, #mainMenu-trigger button').first();
    const body = page.locator('body');

    await trigger.click();
    await expect(body).toHaveClass(/mainMenu-open/);

    // The open/close animation takes 500ms and guards itself against a second
    // trigger while in flight, so wait for it to settle before toggling again.
    await page.waitForTimeout(700);
    await trigger.click();
    await expect(body).not.toHaveClass(/mainMenu-open/);
  });

  test('scroll-to-top button appears after scrolling and returns to top', async ({ page }) => {
    await page.goto('/index.html');
    const scrollTop = page.locator('#scrollTop');

    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(300);
    await expect(scrollTop).toHaveCSS('opacity', '1');

    await scrollTop.click();
    await page.waitForTimeout(1200);
    const finalScroll = await page.evaluate(() => window.scrollY);
    expect(finalScroll).toBeLessThan(50);
  });
});
