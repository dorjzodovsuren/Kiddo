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

/* -------------------------------------------------------------------------
   Phone playback

   The dub used to lag and cut out on a phone and not on a desktop, because
   the sync loop assumed a connection that never stalls: the video buffering
   left the audio talking on its own, and every gap was closed by seeking the
   audio, which on mobile means a range request and an audible hole. These
   specs pin down the behaviour that replaced it.

   Both third parties are stubbed out so the assertions are about this repo's
   code and not about the network: a fake IFrame API stands in for YouTube
   (and lets a test drive the player's state and clock), and the voice-over
   url is answered with a locally generated silent WAV.
---------------------------------------------------------------------------*/

// 12 seconds of 8-bit 8kHz mono silence. Chromium sniffs the container, so
// the .mp3 url in the fixtures is served this happily.
function silentWav(seconds = 12, rate = 8000) {
  const dataLen = seconds * rate;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  buf.fill(128, 44); // 8-bit PCM silence sits at 0x80
  return buf;
}

const FAKE_YT = () => {
  window.__players = [];
  window.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: function (id, opts) {
      const rec = { id, muted: false, time: 0, state: -1, destroyed: false };
      const api = this;
      rec.fire = function (state) {
        rec.state = state;
        if (opts && opts.events && opts.events.onStateChange) {
          opts.events.onStateChange({ data: state, target: api });
        }
      };
      window.__players.push(rec);
      this.mute = () => { rec.muted = true; };
      this.unMute = () => { rec.muted = false; };
      this.getCurrentTime = () => rec.time;
      this.playVideo = () => { rec.state = 1; };
      this.pauseVideo = () => { rec.state = 2; };
      this.destroy = () => { rec.destroyed = true; };
    },
  };
};

async function stubEnvironment(page) {
  await page.addInitScript(FAKE_YT);
  await page.route(/raw\.githubusercontent\.com/, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' },
      body: silentWav(),
    })
  );
}

test.describe('voice-over sync on a slow connection', () => {
  test('the embed asks for inline playback so iOS cannot take the audio away', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const srcs = await page.locator('.video-card-frame iframe').evaluateAll((frames) =>
      frames.map((f) => f.getAttribute('src'))
    );
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src).toContain('playsinline=1');
      expect(src).toContain('enablejsapi=1');
    }
  });

  test('audio is not fetched until a card is used', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-voiceover-audio', { state: 'attached' });

    const preloads = await page.locator('.video-voiceover-audio').evaluateAll((els) =>
      els.map((a) => a.preload)
    );
    for (const preload of preloads) expect(preload).toBe('none');
  });

  test('drift correction bends playback rate first and only seeks as a last resort', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const t = await page.evaluate(() => window.KiddoVoiceover.tuning);

    const result = await page.evaluate(({ soft, hard }) => {
      const c = window.KiddoVoiceover.correctionFor;
      return {
        inTolerance: c(10, 10 + soft / 2, true),
        audioBehind: c(10, 10 + (soft + hard) / 2, true),
        audioAhead: c(10 + (soft + hard) / 2, 10, true),
        wayBehind: c(10, 10 + hard + 2, true),
        wayBehindOnCooldown: c(10, 10 + hard + 2, false),
      };
    }, { soft: t.softTolerance, hard: t.hardTolerance });

    // A gap small enough to be inaudible is left alone rather than chased.
    expect(result.inTolerance).toEqual({ seek: false, rate: 1 });

    // A real but modest gap is closed by speeding up or slowing down, never
    // by a seek: on a phone a seek is a fresh range request and a hole in the
    // sound. The trim stays small enough to be inaudible on speech.
    expect(result.audioBehind.seek).toBe(false);
    expect(result.audioBehind.rate).toBeGreaterThan(1);
    expect(result.audioBehind.rate).toBeLessThanOrEqual(1 + t.maxRateTrim);

    expect(result.audioAhead.seek).toBe(false);
    expect(result.audioAhead.rate).toBeLessThan(1);
    expect(result.audioAhead.rate).toBeGreaterThanOrEqual(1 - t.maxRateTrim);

    // Only a gap too large to trim away earns a seek, and even then only when
    // the cooldown has passed — otherwise it keeps trimming instead of
    // firing seek after seek.
    expect(result.wayBehind.seek).toBe(true);
    expect(result.wayBehindOnCooldown.seek).toBe(false);
    expect(result.wayBehindOnCooldown.rate).toBeCloseTo(1 + t.maxRateTrim, 5);
  });

  test('a buffering video parks the dub instead of letting it run on', async ({ page }) => {
    await stubEnvironment(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const toggle = page.locator('.video-voiceover-toggle').first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'voiceover');

    // The player is muted the moment the dub takes over.
    await expect.poll(() => page.evaluate(() => window.__players[0].muted)).toBe(true);

    await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.PLAYING));
    await expect
      .poll(() => page.locator('.video-voiceover-audio').first().evaluate((a) => a.paused))
      .toBe(false);

    // The video stalls for bytes: the dub has to stall with it, or the two
    // slide apart for as long as the stall lasts.
    await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.BUFFERING));
    await expect
      .poll(() => page.locator('.video-voiceover-audio').first().evaluate((a) => a.paused))
      .toBe(true);

    // And picks back up together.
    await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.PLAYING));
    await expect
      .poll(() => page.locator('.video-voiceover-audio').first().evaluate((a) => a.paused))
      .toBe(false);
  });

  // brainscoop, not nutshell: it is the channel whose JSON gives more than one
  // video a voiceover url, so two cards can actually compete here.
  test('switching a dub on stops any other card still dubbing', async ({ page }) => {
    await stubEnvironment(page);
    await page.goto('/channel-brainscoop.html');
    await page.waitForSelector('.video-card');

    const toggles = page.locator('.video-voiceover-toggle');
    expect(await toggles.count(), 'fixture needs two cards with a voiceover url')
      .toBeGreaterThan(1);

    await toggles.nth(0).click();
    await expect(toggles.nth(0)).toHaveAttribute('data-mode', 'voiceover');

    await toggles.nth(1).scrollIntoViewIfNeeded();
    await toggles.nth(1).click();

    // Two audio streams over one phone connection is the congestion this
    // whole file is trying to avoid.
    await expect(toggles.nth(1)).toHaveAttribute('data-mode', 'voiceover');
    await expect(toggles.nth(0)).toHaveAttribute('data-mode', 'original');
    await expect
      .poll(() => page.locator('.video-voiceover-audio').nth(0).evaluate((a) => a.paused))
      .toBe(true);
  });

  test('turning the dub off unmutes the video and drops any rate trim', async ({ page }) => {
    await stubEnvironment(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const toggle = page.locator('.video-voiceover-toggle').first();
    const audio = page.locator('.video-voiceover-audio').first();

    await toggle.click();
    await page.evaluate(() => {
      document.querySelector('.video-voiceover-audio').playbackRate = 1.05;
    });

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'original');
    await expect.poll(() => page.evaluate(() => window.__players[0].muted)).toBe(false);
    await expect.poll(() => audio.evaluate((a) => a.playbackRate)).toBe(1);
    await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  });

  test('no player is built for a card sitting below the fold', async ({ page }) => {
    await stubEnvironment(page);
    const viewport = { width: 390, height: 600 }; // a phone
    await page.setViewportSize(viewport);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const margin = await page.evaluate(() => parseInt(window.KiddoVoiceover.tuning.playerMargin, 10));
    const wrap = page.locator('.video-voiceover').first();
    const box = await wrap.boundingBox();
    expect(box, 'fixture must keep a voice-over card below the first screen').toBeTruthy();
    expect(box.y, 'fixture card must start further down than the build-ahead margin')
      .toBeGreaterThan(viewport.height + margin);

    // Every player is a postMessage conversation with an iframe. Building them
    // for cards nobody has scrolled to is CPU a phone does not have to spare.
    expect(await page.evaluate(() => window.__players.length)).toBe(0);

    await wrap.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__players.length)).toBeGreaterThan(0);
  });

  test('a toggle reached before its player exists still builds one', async ({ page }) => {
    await stubEnvironment(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    // Without this the card would switch to the dub with no way to mute the
    // player, and both tracks would talk at once.
    await page.locator('.video-voiceover-toggle').first().click();
    await expect.poll(() => page.evaluate(() =>
      window.__players.length > 0 && window.__players[0].muted)).toBe(true);
  });

  test('re-rendering the grid tears its old players down', async ({ page }) => {
    await stubEnvironment(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    await page.locator('.video-voiceover').first().scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__players.length)).toBeGreaterThan(0);

    const sort = page.locator('.video-sort');
    test.skip((await sort.count()) === 0, 'page has no sort control to re-render with');

    const before = await page.evaluate(() => window.__players.length);
    await sort.click();
    await page.waitForSelector('.video-card');

    // Old players left attached to iframes that no longer exist are a
    // postMessage listener leaked per re-render — cheap on a desktop, not on
    // a phone.
    await expect
      .poll(() => page.evaluate((n) =>
        window.__players.slice(0, n).every((p) => p.destroyed), before))
      .toBe(true);
  });
});
