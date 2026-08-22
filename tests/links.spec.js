const { test, expect } = require('@playwright/test');
const { KNOWN_MISSING_PAGES, KNOWN_MISSING_ASSETS } = require('./known-issues');

const KNOWN_ISSUES = new Set([...KNOWN_MISSING_PAGES, ...KNOWN_MISSING_ASSETS]);

function isLocal(url) {
  if (!url) return false;
  return !/^(https?:|mailto:|tel:|#|javascript:)/i.test(url);
}

test('all local page links and assets referenced by index.html resolve', async ({ page, request, baseURL }) => {
  await page.goto('/index.html');
  // Channel links are rendered from JSON, so wait for them before collecting.
  await page.waitForSelector('.video-card');

  const refs = await page.evaluate(() => {
    const urls = new Set();
    document.querySelectorAll('img[src]').forEach((el) => urls.add(el.getAttribute('src')));
    document.querySelectorAll('link[href]').forEach((el) => urls.add(el.getAttribute('href')));
    document.querySelectorAll('script[src]').forEach((el) => urls.add(el.getAttribute('src')));
    document.querySelectorAll('a[href]').forEach((el) => urls.add(el.getAttribute('href')));
    document.querySelectorAll('[data-bg-image], [data-bg-parallax], [data-bg-video]').forEach((el) => {
      ['data-bg-image', 'data-bg-parallax', 'data-bg-video'].forEach((attr) => {
        const v = el.getAttribute(attr);
        if (v) urls.add(v);
      });
    });
    return Array.from(urls);
  });

  const localRefs = [...new Set(refs.filter(isLocal))];
  expect(localRefs.length).toBeGreaterThan(0);

  const broken = [];
  for (const ref of localRefs) {
    const path = ref.split('#')[0].split('?')[0].replace(/^\//, '');
    if (KNOWN_ISSUES.has(path)) continue;

    const res = await request.get(new URL(ref, baseURL).toString());
    if (!res.ok()) broken.push(`${ref} — HTTP ${res.status()}`);
  }

  expect(broken, `Broken local references (not in known-issues.js):\n${broken.join('\n')}`).toEqual([]);
});
