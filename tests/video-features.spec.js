const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CHANNELS = [
  { slug: 'nutshell', page: 'channel-nutshell.html', name: 'Kurzgesagt – In a Nutshell' },
  { slug: 'brainscoop', page: 'channel-brainscoop.html', name: 'The Brain Scoop' },
  { slug: 'schooloflife', page: 'channel-schooloflife.html', name: 'The School of Life' },
];

const HOME_LIMIT = 3;

const data = (slug) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', slug + '.json'), 'utf8'));

const visible = (page, sel) =>
  page.locator(sel).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

// Third-party players add network variance and nothing these specs assert on.
test.beforeEach(async ({ page }) => {
  await page.route(/(youtube\.com|youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
});

test.describe('channel JSON', () => {
  for (const ch of CHANNELS) {
    test(`data/${ch.slug}.json is well formed`, async ({ request, baseURL }) => {
      const res = await request.get(new URL('data/' + ch.slug + '.json', baseURL).toString());
      expect(res.ok()).toBeTruthy();
      const json = await res.json();

      expect(json.slug).toBe(ch.slug);
      expect(json.name).toBe(ch.name);
      expect(json.page).toBe(ch.page);
      expect(Array.isArray(json.videos)).toBeTruthy();
      expect(json.videos.length).toBeGreaterThanOrEqual(HOME_LIMIT);

      // The channel blurbs must be Mongolian, not the template's English.
      for (const field of ['intro', 'about']) {
        expect(json[field], `${ch.slug}.${field}`).toMatch(/[Ѐ-ӿ]/);
        expect(json[field].length).toBeGreaterThan(60);
      }

      for (const v of json.videos) {
        expect(v.url, 'every video needs a url').toMatch(/^https:\/\/www\.youtube\.com\/embed\/[\w-]+$/);
        expect(v.title.trim().length).toBeGreaterThan(0);
        expect(v.summary).toMatch(/[Ѐ-ӿ]/);
        expect(v.summary.length).toBeGreaterThan(80);
        expect(Array.isArray(v.questions)).toBeTruthy();

        // The sort control reads this. It may be null (then ordering falls
        // back to array position), but the key must exist and, when set, be a
        // real date — never a free-text string.
        expect(v, 'published must be present in the schema').toHaveProperty('published');
        if (v.published !== null) {
          expect(v.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isNaN(Date.parse(v.published))).toBe(false);
        }
      }
    });
  }
});

test.describe('fresh data', () => {
  // Regression: the JSON was fetched plainly, so a browser or the GitHub Pages
  // CDN could serve a cached copy and a freshly uploaded channel file would not
  // show up on the live site.
  test('each channel file is requested with a cache-busting url', async ({ page }) => {
    const urls = [];
    page.on('request', (r) => {
      if (/data\/.*\.json/.test(r.url())) urls.push(r.url());
    });

    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    expect(urls.length).toBe(CHANNELS.length);
    for (const u of urls) {
      expect(u, 'data request must not be cacheable by url').toMatch(/\?t=\d+/);
    }
  });

  test('a second load re-requests rather than reusing the first url', async ({ page }) => {
    const seen = [];
    page.on('request', (r) => {
      if (/data\/nutshell\.json/.test(r.url())) seen.push(r.url());
    });

    await page.goto('/index.html');
    await page.waitForSelector('.video-card');
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    expect(seen.length).toBe(2);
    expect(seen[0], 'each load must use a distinct url').not.toBe(seen[1]);
  });

  test('an edited file shows up on the very next load', async ({ page }) => {
    // Stand in for the owner uploading new channel data.
    await page.route(/data\/nutshell\.json/, async (route) => {
      const json = await (await route.fetch()).json();
      json.videos[0].title = 'ШИНЭЭР НЭМСЭН БИЧЛЭГ';
      await route.fulfill({ body: JSON.stringify(json), contentType: 'application/json' });
    });

    await page.goto('/index.html');
    await page.waitForSelector('.video-card');
    await expect(
      page.locator('.video-channel[data-channel="nutshell"] .video-card-title').first()
    ).toHaveText('ШИНЭЭР НЭМСЭН БИЧЛЭГ');
  });
});

test.describe('sort by upload date', () => {
  const nutshellTitles = (page) =>
    page.locator('.video-channel[data-channel="nutshell"] .video-card-title').allTextContents();

  test('the control sits beside the search field', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    const sort = page.locator('.video-sort');
    await expect(sort).toBeVisible();

    const s = await sort.boundingBox();
    const q = await page.locator('.video-search').boundingBox();
    expect(Math.abs(s.y - q.y), 'same row as the search field').toBeLessThan(8);
    expect(s.x, 'to the right of the search field').toBeGreaterThan(q.x);
  });

  test('toggling reverses the order and back again', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    const before = await nutshellTitles(page);
    expect(before.length).toBe(HOME_LIMIT);

    await page.locator('.video-sort').click();
    await expect.poll(() => nutshellTitles(page)).toEqual([...before].reverse());

    await page.locator('.video-sort').click();
    await expect.poll(() => nutshellTitles(page)).toEqual(before);
  });

  test('sorting keeps the homepage to the newest three, it does not swap in older ones', async ({ page }) => {
    const newest = data('nutshell').videos.slice(0, HOME_LIMIT).map((v) => v.title);

    await page.goto('/index.html');
    await page.waitForSelector('.video-card');
    await page.locator('.video-sort').click();

    await expect.poll(() => nutshellTitles(page)).toEqual([...newest].reverse());
    // Same three videos, just reordered.
    await expect.poll(async () => (await nutshellTitles(page)).slice().sort()).toEqual(
      [...newest].sort()
    );
  });

  test('search still works after a sort re-render', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    await page.locator('.video-sort').click();
    await page.fill('#videoSearch', 'хар нүх');

    await expect(page.locator('.video-search-status')).toContainText('бичлэг олдлоо');
    await expect.poll(() => visible(page, '.video-card')).toBeGreaterThan(0);
  });

  test('real published dates drive the order, not array position', async ({ page }) => {
    // Every video dated, deliberately out of array order.
    const dates = ['2020-05-01', '2022-01-01', '2019-01-01', '2023-06-01'];
    await page.route(/data\/nutshell\.json/, async (route) => {
      const json = await (await route.fetch()).json();
      json.videos.forEach((v, i) => { v.published = dates[i]; });
      await route.fulfill({ body: JSON.stringify(json), contentType: 'application/json' });
    });

    const source = data('nutshell').videos.map((v) => v.title);
    const byDateDesc = source
      .map((t, i) => ({ t, d: Date.parse(dates[i]) }))
      .sort((a, b) => b.d - a.d)
      .map((x) => x.t);

    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const shown = await page.locator('.video-card-title').allTextContents();
    expect(shown).toEqual(byDateDesc);
    expect(shown, 'dates must win over array order').not.toEqual(source);

    await page.locator('.video-sort').click();
    await expect.poll(() => page.locator('.video-card-title').allTextContents()).toEqual(
      [...byDateDesc].reverse()
    );
  });

  test('channel pages sort the whole collection', async ({ page }) => {
    const all = data('nutshell').videos.map((v) => v.title);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    expect(await page.locator('.video-card-title').allTextContents()).toEqual(all);
    await page.locator('.video-sort').click();
    await expect.poll(() => page.locator('.video-card-title').allTextContents()).toEqual(
      [...all].reverse()
    );
    // The description carousels must survive the re-render.
    await expect(page.locator('.video-desc')).toHaveCount(all.length);
  });
});

test.describe('homepage collection', () => {
  test('renders three channels with only the newest videos each', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    await expect(page.locator('.video-channel')).toHaveCount(CHANNELS.length);
    await expect(page.locator('.video-card')).toHaveCount(CHANNELS.length * HOME_LIMIT);

    for (const ch of CHANNELS) {
      const block = page.locator(`.video-channel[data-channel="${ch.slug}"]`);
      await expect(block.locator('.video-card')).toHaveCount(HOME_LIMIT);
    }
  });

  test('cards are built from the JSON, not hardcoded markup', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    // index.html itself must not contain any video url.
    const raw = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    expect(raw, 'video urls belong in data/*.json').not.toContain('youtube.com/embed/');

    // What renders must match the JSON, in order.
    for (const ch of CHANNELS) {
      const expected = data(ch.slug).videos.slice(0, HOME_LIMIT);
      const block = page.locator(`.video-channel[data-channel="${ch.slug}"]`);

      const titles = await block.locator('.video-card-title').allTextContents();
      expect(titles).toEqual(expected.map((v) => v.title));

      const srcs = await block.locator('iframe').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
      expect(srcs).toEqual(expected.map((v) => v.url));
    }
  });

  test('each channel links through to its full page', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');

    for (const ch of CHANNELS) {
      const block = page.locator(`.video-channel[data-channel="${ch.slug}"]`);
      await expect(block.locator(`a[href="${ch.page}"]`).first()).toBeVisible();
    }
  });

  test('search still filters the rendered cards', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');
    const total = CHANNELS.length * HOME_LIMIT;
    await expect.poll(() => visible(page, '.video-card')).toBe(total);

    await page.fill('#videoSearch', 'хар нүх');
    await expect(page.locator('.video-search-status')).toContainText('бичлэг олдлоо');
    await expect.poll(() => visible(page, '.video-card')).toBeLessThan(total);

    await page.locator('.video-search-clear').click();
    await expect.poll(() => visible(page, '.video-card')).toBe(total);
  });
});

test.describe('channel pages', () => {
  for (const ch of CHANNELS) {
    test(`${ch.page} renders every video from its JSON`, async ({ page }) => {
      const expected = data(ch.slug);
      await page.goto('/' + ch.page);
      await page.waitForSelector('.video-card');

      await expect(page.locator('.channel-hero-title')).toHaveText(ch.name);
      await expect(page.locator('.video-card')).toHaveCount(expected.videos.length);

      const titles = await page.locator('.video-card-title').allTextContents();
      expect(titles).toEqual(expected.videos.map((v) => v.title));
    });
  }

  test('the videos dropdown still reaches each channel page with search', async ({ page }) => {
    await page.goto('/index.html');
    // Let the page settle before driving the menu, otherwise the hover can land
    // before the theme has wired the dropdown up.
    await page.waitForSelector('.video-card');

    await page.locator('#mainMenu nav > ul > li.dropdown').first().hover();

    const link = page.locator('#mainMenu nav a[href="channel-nutshell.html"]');
    await expect(link).toBeVisible();
    await link.click();

    await page.waitForURL('**/channel-nutshell.html');
    await expect(page.locator('#videoSearch')).toBeVisible();
    await expect(page.locator('.video-search-icon')).toBeVisible();
  });
});

test.describe('description carousel', () => {
  test('every card has a carousel with one slide per description part', async ({ page }) => {
    const expected = data('nutshell');
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-desc');

    await expect(page.locator('.video-desc')).toHaveCount(expected.videos.length);

    for (let i = 0; i < expected.videos.length; i++) {
      const v = expected.videos[i];
      const desc = page.locator('.video-desc').nth(i);
      // slide 1 is the summary, then one per question
      await expect(desc.locator('.video-desc-slide')).toHaveCount(1 + v.questions.length);
      await expect(desc.locator('.video-desc-dot')).toHaveCount(1 + v.questions.length);
    }
  });

  test('the next control advances the carousel', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-desc');

    const desc = page.locator('.video-desc').first();
    const track = desc.locator('.video-desc-track');

    await expect(track).toHaveCSS('transform', /matrix|none/);
    const before = await track.evaluate((e) => e.style.transform);

    await desc.locator('.video-desc-next').click();
    await expect.poll(() => track.evaluate((e) => e.style.transform)).not.toBe(before);

    await expect(desc.locator('.video-desc-dot').nth(1)).toHaveClass(/is-active/);
  });

  test('clicking the description expands it, and it collapses again', async ({ page }) => {
    const first = data('nutshell').videos[0];
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-desc');

    const desc = page.locator('.video-desc').first();
    await expect(desc).not.toHaveClass(/is-expanded/);
    await expect(desc.locator('.video-desc-full')).toBeHidden();

    await desc.locator('.video-desc-viewport').click();

    await expect(desc).toHaveClass(/is-expanded/);
    await expect(desc.locator('.video-desc-full')).toBeVisible();
    // Expanded shows the whole summary plus every question.
    await expect(desc.locator('.video-desc-summary-full')).toHaveText(first.summary);
    await expect(desc.locator('.video-desc-questions li')).toHaveCount(first.questions.length);

    await desc.locator('.video-desc-toggle').click();
    await expect(desc).not.toHaveClass(/is-expanded/);
  });

  test('the homepage keeps plain summaries, not carousels', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.video-card');
    await expect(page.locator('.video-desc')).toHaveCount(0);
    await expect(page.locator('.video-card-summary').first()).toBeVisible();
  });
});

test.describe('login removal', () => {
  const GONE = ['login.html', 'js/auth.js', 'js/login.js'];

  for (const f of GONE) {
    test(`${f} no longer exists`, async () => {
      expect(fs.existsSync(path.join(__dirname, '..', f)), `${f} should be deleted`).toBe(false);
    });
  }

  for (const p of ['index.html', ...CHANNELS.map((c) => c.page)]) {
    test(`${p} has no sign-in surface left`, async ({ page }) => {
      const raw = fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
      expect(raw).not.toContain('auth.js');
      expect(raw).not.toContain('login.html');

      await page.goto('/' + p);
      await page.waitForSelector('.video-card');
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/Нэвтрэх|Гарах/);
      await expect(page.locator('.video-locked-notice')).toHaveCount(0);
    });
  }
});

test.describe('Mongolian copy', () => {
  test('homepage channel blurbs are Mongolian', async ({ page }) => {
    await page.goto('/index.html');
    // Scope to the "what we do" section: the team section below it is also
    // .background-grey and has its own .col-lg-4 paragraphs.
    const blurbs = await page
      .locator('section.background-grey:not(#kiddoteam) .col-lg-4 p')
      .allTextContents();
    expect(blurbs.length).toBe(CHANNELS.length);

    for (const t of blurbs) {
      expect(t).toMatch(/[Ѐ-ӿ]/);
      // Allow proper nouns, reject running English prose.
      const words = (t.match(/[A-Za-z]{4,}/g) || []).filter(
        (w) => !/^(Youtube|Kurzgesagt|Nutshel|Nutshell|Brain|Scoop|School|Life|channel)$/i.test(w)
      );
      expect(words, `stray English in: ${t.slice(0, 60)}`).toEqual([]);
    }
  });

  // One test per page: four sequential page loads in a single test ran past
  // the 30s default.
  for (const p of ['index.html', ...CHANNELS.map((c) => c.page)]) {
    test(`${p} ships no lorem ipsum placeholder`, async ({ page }) => {
      await page.goto('/' + p);
      const body = await page.locator('body').innerText();
      expect(body.toLowerCase(), `${p} still ships placeholder copy`).not.toContain('lorem ipsum');
    });
  }
});
