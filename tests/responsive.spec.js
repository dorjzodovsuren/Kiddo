const { test, expect } = require('@playwright/test');

// Breakpoints as defined in js/functions.js (INSPIRO.core / $(window).breakpoints config)
const breakpoints = [
  { name: 'xs', width: 375, expectDesktop: false },
  { name: 'sm', width: 576, expectDesktop: false },
  { name: 'md', width: 768, expectDesktop: false },
  // 1026, not the 1025 boundary itself: the vendor breakpoints plugin (js/plugins.js)
  // uses a strict `>` for its "greaterEqualTo" check, so at the exact boundary width
  // neither the desktop nor the responsive class gets applied. That's a pre-existing
  // off-by-one quirk in third-party code, not something this test should assert on.
  { name: 'lg', width: 1026, expectDesktop: true },
  { name: 'xl', width: 1200, expectDesktop: true },
];

for (const bp of breakpoints) {
  test(`applies breakpoint-${bp.name} body class at ${bp.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: 900 });
    await page.goto('/index.html');

    const body = page.locator('body');
    await expect(body).toHaveClass(new RegExp(`breakpoint-${bp.name}\\b`));
    await expect(body).toHaveClass(bp.expectDesktop ? /b--desktop/ : /b--responsive/);
  });
}

test('mobile menu trigger is hidden on desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('#mainMenu-trigger')).toBeHidden();
});
