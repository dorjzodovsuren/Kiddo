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

  test('the dub does not download until the visitor engages with the card', async ({ page }) => {
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    // A loading media element holds back the page's load event, so nothing is
    // fetched up front — js/video-voiceover.js promotes this on engagement.
    const preload = await page.locator('.video-voiceover-audio').first().evaluate((a) => a.preload);
    expect(preload).toBe('none');
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

/*
  The sync engine below is driven against a fake YouTube player and a locally
  served audio file, so these specs measure the code's own behaviour rather
  than the network: a real embed gives no way to hold a clock still, and the
  dub url is a third-party download.
*/

// 60 s of 8 kHz 8-bit silence — small enough to fulfil inline, long enough to
// seek around in.
function silentWav(seconds) {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples, 128);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(samples, 40);
  return buf;
}

const WAV = silentWav(60);

// Range support matters: a media response that cannot be ranged is not
// seekable, and the whole point of the code under test is seeking.
async function stubVoiceoverAudio(page) {
  await page.route(/raw\.githubusercontent\.com/, (route) => {
    const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range || '');
    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(WAV.length) },
        body: WAV,
      });
    }
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : WAV.length - 1;
    const slice = WAV.subarray(start, end + 1);
    return route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${end}/${WAV.length}`,
      },
      body: slice,
    });
  });
}

// A stand-in for the IFrame API: the clock and the play state are ours to set,
// which is what lets a drift be created on purpose.
async function stubYouTubeApi(page) {
  await page.addInitScript(() => {
    const players = [];
    window.__players = players;
    window.YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
      Player: function (id, opts) {
        const p = {
          id,
          time: 0,
          rate: 1,
          state: 1,
          muted: false,
          getCurrentTime: () => p.time,
          getPlaybackRate: () => p.rate,
          getPlayerState: () => p.state,
          mute: () => { p.muted = true; },
          unMute: () => { p.muted = false; },
          pauseVideo: () => { p.state = 2; },
          playVideo: () => { p.state = 1; },
          fire: (state) => {
            p.state = state;
            opts.events.onStateChange({ data: state });
          },
        };
        players.push(p);
        return p;
      },
    };
  });
}

const AUDIO = '.video-voiceover-audio';

async function openCard(page, { readyState = 4 } = {}) {
  await stubVoiceoverAudio(page);
  await stubYouTubeApi(page);
  await page.goto('/channel-nutshell.html');
  await page.waitForSelector('.video-card');
  await page.waitForFunction(() => (window.__players || []).length > 0);
  // Playing the video is what warms the dub up, exactly as it does for a
  // visitor; nothing is fetched before that.
  await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.PLAYING));
  // The dub only counts as loaded once the browser has enough of it; every
  // spec below starts from a known readyState so the buffering path is
  // exercised deliberately rather than by chance.
  await page.waitForFunction(
    (args) => {
      const a = document.querySelector(args.sel);
      return a && a.readyState >= args.want;
    },
    { sel: AUDIO, want: readyState },
    { timeout: 15000 }
  );
}

// The dub is playing and nothing is buffering: the point where the specs can
// drive the player without racing the media element's own events.
const waitSettled = (page) =>
  page.waitForFunction(
    (sel) => {
      const a = document.querySelector(sel);
      const wrap = document.querySelector('.video-voiceover');
      return a && !a.paused && a.readyState >= 4 && wrap.getAttribute('data-busy') === 'false';
    },
    AUDIO,
    { timeout: 15000 }
  );

const audioState = (page) =>
  page.evaluate((sel) => {
    const a = document.querySelector(sel);
    return { currentTime: a.currentTime, playbackRate: a.playbackRate, paused: a.paused };
  }, AUDIO);

test.describe('voice-over sync', () => {
  test('pressing the toggle starts the download before the click completes', async ({ page }) => {
    await stubVoiceoverAudio(page);
    await stubYouTubeApi(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');

    const audio = page.locator(AUDIO).first();
    expect(await audio.evaluate((a) => a.preload)).toBe('none');

    // Down, not up: waiting for the click would put the whole download after
    // the tap, which is the lag this is here to remove.
    await page.locator('.video-voiceover-toggle').first().dispatchEvent('pointerdown');
    expect(await audio.evaluate((a) => a.preload)).toBe('auto');
  });

  test('a video that starts playing warms its dub up in the background', async ({ page }) => {
    await stubVoiceoverAudio(page);
    await stubYouTubeApi(page);
    await page.goto('/channel-nutshell.html');
    await page.waitForSelector('.video-card');
    await page.waitForFunction(() => (window.__players || []).length > 0);

    await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.PLAYING));

    const audio = page.locator(AUDIO).first();
    expect(await audio.evaluate((a) => a.preload)).toBe('auto');
    await page.waitForFunction((sel) => document.querySelector(sel).readyState >= 1, AUDIO, {
      timeout: 10000,
    });
  });

  test('switching to the dub starts it at the video\'s position, not at 0:00', async ({ page }) => {
    await openCard(page);

    await page.evaluate(() => { window.__players[0].time = 21; });
    await page.locator('.video-voiceover-toggle').first().click();

    await page.waitForFunction(
      (sel) => Math.abs(document.querySelector(sel).currentTime - 21) < 1,
      AUDIO,
      { timeout: 5000 }
    );
    expect(await page.evaluate(() => window.__players[0].muted)).toBe(true);
  });

  test('small drift is corrected by playback rate, not by seeking', async ({ page }) => {
    await openCard(page);
    await page.locator('.video-voiceover-toggle').first().click();
    await page.waitForFunction((sel) => !document.querySelector(sel).paused, AUDIO);

    // Put the video a third of a second behind the dub: inside the seek
    // threshold, so the dub should be slowed down instead of re-fetched.
    await page.evaluate((sel) => {
      window.__players[0].time = document.querySelector(sel).currentTime - 0.35;
    }, AUDIO);

    await page.waitForFunction((sel) => document.querySelector(sel).playbackRate < 1, AUDIO, {
      timeout: 5000,
    });
    const { playbackRate } = await audioState(page);
    expect(playbackRate).toBeGreaterThan(0.9); // a nudge, not a pitch shift
  });

  test('a real gap is closed by seeking to the video position', async ({ page }) => {
    await openCard(page);
    await page.locator('.video-voiceover-toggle').first().click();
    await page.waitForFunction((sel) => !document.querySelector(sel).paused, AUDIO);

    await page.evaluate(() => { window.__players[0].time = 40; });

    await page.waitForFunction(
      (sel) => Math.abs(document.querySelector(sel).currentTime - 40) < 1.5,
      AUDIO,
      { timeout: 6000 }
    );
  });

  test('the video waits while the dub buffers instead of running ahead of it', async ({ page }) => {
    await openCard(page);
    await page.locator('.video-voiceover-toggle').first().click();
    await waitSettled(page);
    await page.evaluate(() => { window.__players[0].state = 1; });

    await page.evaluate((sel) => {
      document.querySelector(sel).dispatchEvent(new Event('waiting'));
    }, AUDIO);

    expect(await page.evaluate(() => window.__players[0].getPlayerState())).toBe(2);
    await expect(page.locator('.video-voiceover').first()).toHaveAttribute('data-busy', 'true');

    await page.evaluate((sel) => {
      document.querySelector(sel).dispatchEvent(new Event('playing'));
    }, AUDIO);

    expect(await page.evaluate(() => window.__players[0].getPlayerState())).toBe(1);
    await expect(page.locator('.video-voiceover').first()).toHaveAttribute('data-busy', 'false');
  });

  test('pausing the video pauses the dub, and playing again resyncs it', async ({ page }) => {
    await openCard(page);
    await page.locator('.video-voiceover-toggle').first().click();
    await waitSettled(page);

    await page.evaluate(() => window.__players[0].fire(window.YT.PlayerState.PAUSED));
    await page.waitForFunction((sel) => document.querySelector(sel).paused, AUDIO);

    await page.evaluate(() => {
      window.__players[0].time = 33;
      window.__players[0].fire(window.YT.PlayerState.PLAYING);
    });

    await page.waitForFunction(
      (sel) => {
        const a = document.querySelector(sel);
        return !a.paused && Math.abs(a.currentTime - 33) < 1.5;
      },
      AUDIO,
      { timeout: 5000 }
    );
  });

  test('re-sorting the grid does not leave the old dub playing underneath it', async ({ page }) => {
    await openCard(page);
    await page.locator('.video-voiceover-toggle').first().click();
    await waitSettled(page);

    // The sort rebuilds the collection, detaching the audio element that is
    // playing — a detached element keeps going unless it is stopped.
    await page.locator('.video-sort').first().click();
    await page.waitForSelector('.video-card');

    await page.waitForFunction(
      (sel) => [].every.call(document.querySelectorAll(sel), (a) => a.paused),
      AUDIO,
      { timeout: 5000 }
    );
  });

  test('switching back to the original track unmutes the video and stops the dub', async ({ page }) => {
    await openCard(page);
    const toggle = page.locator('.video-voiceover-toggle').first();

    await toggle.click();
    await page.waitForFunction((sel) => !document.querySelector(sel).paused, AUDIO);

    await toggle.click();
    await page.waitForFunction((sel) => document.querySelector(sel).paused, AUDIO);
    expect(await page.evaluate(() => window.__players[0].muted)).toBe(false);
    expect((await audioState(page)).playbackRate).toBe(1);
  });
});
