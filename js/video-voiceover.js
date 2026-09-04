/*
  KidDo — voice-over playback.

  Each video card that has a "voiceover" url in its channel's JSON (built by
  js/video-data.js) carries one toggle button and a hidden <audio> element
  already pointed at that url — there is no upload path and nothing is saved
  per-visitor, so this file only has to keep that audio in step with the
  YouTube player:

    - "Эх дуу" / "Оруулсан дуу" mutes the YouTube player and plays the
      voice-over audio in sync with it, or the reverse.
    - A short interval measures drift against the player's clock, because the
      YouTube API emits no "seeked" event to react to directly.

  Keeping a phone in sync is the whole difficulty here. Two habits of mobile
  browsers shape the code below:

    1. A hard seek (assigning audio.currentTime) is expensive — it costs a
       fresh range request over the network and a decoder flush, typically far
       more than the drift being corrected. Seeking on every small drift makes
       the audio stall permanently: each seek loses more time than it fixes, so
       the next tick seeks again. Small drift is therefore corrected by nudging
       playbackRate a few percent — inaudible, and it costs nothing — and only
       a real gap is seeked, at most once per SEEK_COOLDOWN.
    2. Media only starts loading when it is asked to, and a phone on mobile
       data needs seconds for that. So the audio is primed (preload switched to
       "auto") as soon as the visitor shows intent — the video starts playing,
       or a finger goes down on the toggle — rather than at the click, and the
       video is paused while the audio buffers instead of running ahead of it.
*/
(function (window, document) {
  "use strict";

  var SYNC_INTERVAL = 250;     // ms between drift measurements
  var SOFT_DRIFT = 0.12;       // s — closer than this counts as in sync
  var HARD_DRIFT = 0.75;       // s — further than this is seeked, not nudged
  var MAX_RATE_NUDGE = 0.06;   // ±6% playback rate reads as in sync, not as pitch
  var SEEK_COOLDOWN = 1200;    // ms — floor between two hard seeks
  var BUFFER_GIVEUP = 8000;    // ms — how long the video waits for stalled audio

  var HAVE_METADATA = 1;       // readyState: duration known, seeking allowed
  var HAVE_FUTURE_DATA = 3;    // readyState: enough buffered to start playing

  var entries = [];
  var apiLoading = false;
  var apiWaiters = [];

  function now() {
    return Date.now();
  }

  // The player is gone (or never arrived) on a card whose iframe failed to
  // load, and the API throws on a torn-down player, so every call goes
  // through here and the card degrades to "audio only, no mute control".
  function playerCall(entry, name, fallback) {
    if (entry.player && typeof entry.player[name] === "function") {
      try {
        return entry.player[name]();
      } catch (e) {
        return fallback;
      }
    }
    return fallback;
  }

  function getPlayerTime(entry) {
    return playerCall(entry, "getCurrentTime", 0) || 0;
  }

  function getPlayerRate(entry) {
    return playerCall(entry, "getPlaybackRate", 1) || 1;
  }

  function isPlayerPlaying(entry) {
    var YTns = window.YT;
    return !!YTns && playerCall(entry, "getPlayerState", null) === YTns.PlayerState.PLAYING;
  }

  function muteVideo(entry) {
    playerCall(entry, "mute", null);
  }

  function unmuteVideo(entry) {
    playerCall(entry, "unMute", null);
  }

  // Marks the card as waiting on the network so the toggle can show it; the
  // label itself never changes, it stays the thing the visitor pressed.
  function setBusy(entry, busy) {
    entry.wrap.setAttribute("data-busy", busy ? "true" : "false");
    entry.toggle.setAttribute("aria-busy", busy ? "true" : "false");
  }

  // Switching preload to "auto" starts the download well before the toggle is
  // pressed. Cheap: it only ever happens on a card the visitor is using.
  function primeAudio(entry) {
    if (entry.primed) return;
    entry.primed = true;
    entry.audio.preload = "auto";
    if (entry.audio.readyState === 0) {
      try {
        entry.audio.load();
      } catch (e) {
        // Nothing to do: playback still works, it just starts colder.
      }
    }
  }

  // currentTime cannot be assigned before the browser knows the duration, and
  // that assignment is silently dropped (or throws) if it is tried too early —
  // which is what leaves a voice-over playing from 0:00 under a video already
  // minutes in. Anything too early is replayed once metadata arrives.
  function seekAudio(entry, time) {
    if (entry.audio.readyState < HAVE_METADATA) {
      entry.pendingSeek = time;
      return;
    }
    entry.pendingSeek = null;
    try {
      entry.audio.currentTime = time;
      entry.lastSeekAt = now();
    } catch (e) {
      entry.pendingSeek = time;
    }
  }

  // Only seek when the gap is worth a seek. Re-seeking to a position the audio
  // is already at is not free: it flushes the decoder and fires "waiting",
  // which would hold the video, which would resync again on release — a loop
  // that leaves the dub permanently stalled on a slow connection.
  function resync(entry) {
    var target = getPlayerTime(entry);
    if (Math.abs(entry.audio.currentTime - target) <= SOFT_DRIFT) return;
    seekAudio(entry, target);
  }

  function setRate(entry, rate) {
    if (Math.abs(entry.audio.playbackRate - rate) < 0.005) return;
    try {
      entry.audio.playbackRate = rate;
    } catch (e) {
      // Some browsers refuse rates outside their supported range; the drift
      // then falls to the hard-seek path instead.
    }
  }

  function playAudio(entry) {
    var started = entry.audio.play();
    if (started && typeof started.catch === "function") {
      started.catch(function () {
        // Autoplay can be refused outside a user gesture; the toggle click
        // that reaches here is itself a gesture, so this is only a safety net.
      });
    }
  }

  /*
    Holding the video while the voice-over buffers is what removes the
    "video runs, dub silent, then dub is minutes behind" effect on a phone.
    The pause is ours, not the visitor's, so onPlayerStateChange has to be
    able to tell the two apart — that is what entry.holding is for.
  */
  function holdVideo(entry) {
    if (entry.mode !== "voiceover") return;
    setBusy(entry, true);
    if (entry.holding || !isPlayerPlaying(entry)) return;
    entry.holding = true;
    playerCall(entry, "pauseVideo", null);
    entry.holdTimer = window.setTimeout(function () {
      // The audio is not coming in a reasonable time; let the video run
      // rather than leaving the card frozen, and let the drift loop catch up
      // whenever the audio does arrive.
      releaseVideo(entry, false);
    }, BUFFER_GIVEUP);
  }

  // Drops the hold without touching the player, for when the video is already
  // moving again — the visitor pressed play on it themselves, or it ended.
  // Leaving the flag set there would make the next real pause look like ours.
  function cancelHold(entry) {
    if (entry.holdTimer) {
      window.clearTimeout(entry.holdTimer);
      entry.holdTimer = null;
    }
    setBusy(entry, false);
    var wasHolding = entry.holding;
    entry.holding = false;
    return wasHolding;
  }

  function releaseVideo(entry, realign) {
    if (!cancelHold(entry)) return;
    if (realign) resync(entry);
    playerCall(entry, "playVideo", null);
  }

  function stopSyncLoop(entry) {
    if (entry.syncTimer) {
      window.clearInterval(entry.syncTimer);
      entry.syncTimer = null;
    }
    setRate(entry, 1);
  }

  /*
    One measurement per tick:
      drift > 0  → the voice-over is ahead of the video, slow it down
      drift < 0  → it is behind, speed it up
    Anything past HARD_DRIFT is a genuine gap (the visitor scrubbed, or the
    audio stalled) and is worth the cost of a seek — but no more often than
    SEEK_COOLDOWN, so a slow seek can never trigger the next one.
  */
  function syncTick(entry) {
    if (entry.mode !== "voiceover") return;
    if (entry.audio.readyState < HAVE_METADATA) return;
    if (entry.holding || entry.audio.ended) return;
    if (!isPlayerPlaying(entry)) return;

    var base = getPlayerRate(entry);
    var drift = entry.audio.currentTime - getPlayerTime(entry);
    var size = Math.abs(drift);

    if (size > HARD_DRIFT) {
      if (now() - entry.lastSeekAt < SEEK_COOLDOWN) {
        setRate(entry, base * (drift > 0 ? 1 - MAX_RATE_NUDGE : 1 + MAX_RATE_NUDGE));
        return;
      }
      setRate(entry, base);
      seekAudio(entry, getPlayerTime(entry));
      return;
    }

    if (size <= SOFT_DRIFT) {
      setRate(entry, base);
      return;
    }

    var nudge = (size / HARD_DRIFT) * MAX_RATE_NUDGE;
    setRate(entry, base * (drift > 0 ? 1 - nudge : 1 + nudge));
  }

  function startSyncLoop(entry) {
    stopSyncLoop(entry);
    entry.syncTimer = window.setInterval(function () {
      syncTick(entry);
    }, SYNC_INTERVAL);
  }

  function beginVoiceover(entry) {
    muteVideo(entry);
    primeAudio(entry);
    // play() first, and synchronously: it has to stay inside the click gesture
    // for iOS to allow it at all. The seek is separate and may have to wait
    // for metadata.
    playAudio(entry);
    resync(entry);
    if (entry.audio.readyState < HAVE_FUTURE_DATA) holdVideo(entry);
    startSyncLoop(entry);
  }

  function endVoiceover(entry) {
    releaseVideo(entry, false);
    stopSyncLoop(entry);
    entry.audio.pause();
    entry.pendingSeek = null;
    unmuteVideo(entry);
  }

  function applyMode(entry, mode) {
    entry.mode = mode;
    var isVoiceover = mode === "voiceover";
    entry.toggle.setAttribute("data-mode", mode);
    entry.toggle.setAttribute("aria-pressed", isVoiceover ? "true" : "false");
    entry.toggleLabel.textContent = isVoiceover ? "Оруулсан дуу" : "Эх дуу";

    if (isVoiceover) {
      beginVoiceover(entry);
    } else {
      endVoiceover(entry);
    }
  }

  function onPlayerStateChange(entry, event) {
    var YTns = window.YT;
    if (!YTns) return;

    if (event.data === YTns.PlayerState.PLAYING) {
      cancelHold(entry);
      primeAudio(entry);
      if (entry.mode === "voiceover") {
        resync(entry);
        playAudio(entry);
        startSyncLoop(entry);
      }
    } else if (event.data === YTns.PlayerState.PAUSED) {
      if (entry.holding) return; // our own buffering pause, not the visitor's
      if (entry.mode === "voiceover") entry.audio.pause();
      stopSyncLoop(entry);
    } else if (event.data === YTns.PlayerState.BUFFERING) {
      // The video is the one waiting now: hold the voice-over where it is
      // instead of letting it run on and arrive out of sync.
      if (entry.mode === "voiceover" && !entry.holding) entry.audio.pause();
    } else if (event.data === YTns.PlayerState.ENDED) {
      cancelHold(entry);
      stopSyncLoop(entry);
      entry.audio.pause();
      entry.audio.currentTime = 0;
    }
  }

  function ensureYouTubeApi(whenReady) {
    if (window.YT && window.YT.Player) {
      whenReady();
      return;
    }
    apiWaiters.push(whenReady);
    if (apiLoading) return;
    apiLoading = true;

    var previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof previous === "function") previous();
      var waiters = apiWaiters;
      apiWaiters = [];
      waiters.forEach(function (fn) { fn(); });
    };

    var tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  function createPlayer(entry) {
    if (!document.getElementById(entry.iframeId)) return; // card was re-rendered away
    try {
      entry.player = new window.YT.Player(entry.iframeId, {
        events: {
          onStateChange: function (event) { onPlayerStateChange(entry, event); },
        },
      });
    } catch (e) {
      // A malformed or removed iframe just leaves this card without mute
      // control; the toggle still plays/pauses the voice-over audio itself.
    }
  }

  function wireAudio(entry) {
    var audio = entry.audio;

    audio.addEventListener("loadedmetadata", function () {
      if (entry.pendingSeek == null) return;
      var target = entry.pendingSeek;
      entry.pendingSeek = null;
      seekAudio(entry, target);
    });

    // The voice-over ran out of buffer: stop the video rather than let it walk
    // away from the audio while the next chunk arrives.
    audio.addEventListener("waiting", function () { holdVideo(entry); });
    audio.addEventListener("stalled", function () { holdVideo(entry); });

    // Buffer refilled — line the audio back up with the video and resume.
    audio.addEventListener("playing", function () { releaseVideo(entry, true); });
    audio.addEventListener("canplaythrough", function () { releaseVideo(entry, true); });

    // A dead url would otherwise leave a muted video and no sound at all, so
    // fall back to the original track instead of silence.
    audio.addEventListener("error", function () {
      if (entry.mode === "voiceover") applyMode(entry, "original");
    });
  }

  function buildEntry(wrap) {
    var entry = {
      wrap: wrap,
      iframeId: wrap.getAttribute("data-player-id"),
      mode: "original",
      player: null,
      syncTimer: null,
      holdTimer: null,
      holding: false,
      primed: false,
      pendingSeek: null,
      lastSeekAt: 0,
      toggle: wrap.querySelector(".video-voiceover-toggle"),
      audio: wrap.querySelector(".video-voiceover-audio"),
    };
    entry.toggleLabel = entry.toggle.querySelector(".video-voiceover-toggle-label");

    // Start fetching on the press, not on the click: on a phone that head
    // start is the difference between the dub coming in late and coming in
    // with the tap.
    entry.toggle.addEventListener("pointerdown", function () { primeAudio(entry); });
    entry.toggle.addEventListener("touchstart", function () { primeAudio(entry); }, { passive: true });
    entry.toggle.addEventListener("focus", function () { primeAudio(entry); });

    entry.toggle.addEventListener("click", function () {
      applyMode(entry, entry.mode === "original" ? "voiceover" : "original");
    });

    wireAudio(entry);
    ensureYouTubeApi(function () { createPlayer(entry); });

    return entry;
  }

  // The collection is rebuilt wholesale (container.innerHTML = "") when the
  // sort changes, so an entry's audio element is detached while it may still
  // be playing — and a detached element keeps playing. Silence it, or the old
  // dub carries on underneath the new cards.
  function teardown(entry) {
    stopSyncLoop(entry);
    if (entry.holdTimer) {
      window.clearTimeout(entry.holdTimer);
      entry.holdTimer = null;
    }
    entry.audio.pause();
  }

  function boot() {
    entries.forEach(teardown);
    entries = [].slice.call(document.querySelectorAll(".video-voiceover")).map(buildEntry);
  }

  // Phones throttle timers hard in a backgrounded tab, so the drift measured
  // on return is stale by however long the tab was away: resync once, up front.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    entries.forEach(function (entry) {
      if (entry.mode === "voiceover") resync(entry);
    });
  });

  document.addEventListener("kiddo:rendered", boot);
})(window, document);
