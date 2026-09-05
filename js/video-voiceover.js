/*
  KidDo — voice-over playback.

  Each video card that has a "voiceover" url in its channel's JSON (built by
  js/video-data.js) carries one toggle button and a hidden <audio> element
  already pointed at that url — there is no upload path and nothing is saved
  per-visitor, so this file only has to keep that audio in step with the
  YouTube player:

    - "Эх дуу" / "Оруулсан дуу" mutes the YouTube player and plays the
      voice-over audio in sync with it, or the reverse.
    - A correction tick keeps the two together. YouTube's API emits no
      "seeked" event, so drift has to be measured rather than reacted to.

  Everything below exists because a phone behaves nothing like a desktop on
  this page, and the first version of this file assumed it did:

    * A phone on mobile data re-buffers constantly. When the *video* stalls
      (BUFFERING) the dub used to keep talking, and when the *audio* stalled
      the video ran on — either way the two slid apart and the next
      correction yanked the audio, which is what "lagging" sounded like.
      Now whichever side stalls parks the other one until it recovers.
    * Correcting drift by assigning currentTime is a seek, and a seek on a
      phone means a fresh range request and an audible gap. Doing that every
      500ms on a jittery connection is a seek storm that never converges —
      the "disconnects". Small gaps are now closed by bending playbackRate a
      few percent (pitch preserved, inaudible); a real seek is the last
      resort and is rate-limited.
    * getCurrentTime() answers from a cached state that a busy phone updates
      late, so the same reading arrives twice and drift looks like a jump.
      Readings are anchored to a monotonic clock and interpolated between.
    * A channel page holds twelve iframes. Building twelve players up front
      is twelve postMessage conversations competing for one phone CPU, so a
      player is built only once its card comes near the viewport.
    * On iOS a video that goes fullscreen takes the audio session with it and
      the dub simply stops (js/video-data.js asks for playsinline to avoid
      that), and an <audio> element that has never been touched inside a
      gesture cannot be started later from a player event — so the toggle
      unlocks it on the way down, before the click completes.
    * A background tab throttles timers, so drift builds silently; coming
      back re-anchors and resyncs once instead of fighting the throttle.

  Waits for the same "kiddo:rendered" event video-search.js uses, since cards
  are rendered from JSON after this script loads.
*/
(function (window, document) {
  "use strict";

  // Gaps under this are left alone: chasing them costs more than it fixes.
  var SOFT_TOLERANCE = 0.12;
  // Above this a seek is cheaper than waiting for a rate trim to close it.
  var HARD_TOLERANCE = 1.0;
  // How far playbackRate may bend, either way. 6% closes a half-second gap in
  // about eight seconds and stays inaudible on speech with pitch preserved.
  var MAX_RATE_TRIM = 0.06;
  // A seek on a phone is a range request; never fire them back to back.
  var SEEK_COOLDOWN_MS = 1500;
  var TICK_MS = 700;
  // How long the video waits on audio that is not arriving before the card
  // gives up and hands playback back to the original sound.
  var STALL_LIMIT_MS = 8000;
  // Build the player this far ahead of the card scrolling into view.
  var PLAYER_MARGIN = "300px";

  var LABEL_ORIGINAL = "Эх дуу";
  var LABEL_VOICEOVER = "Оруулсан дуу";
  var STATUS_BUFFERING = "Дуу ачаалж байна…";
  var STATUS_UNAVAILABLE = "Дуу ачаалж чадсангүй — эх дуу тавигдлаа.";
  var STATUS_BLOCKED = "Дарж дууг эхлүүлнэ үү.";

  var entries = [];

  function now() {
    return window.performance && window.performance.now
      ? window.performance.now()
      : Date.now();
  }

  /* ---------------------------------------------------------------
     The correction itself

     Pure on purpose: given where the audio is and where the video is, say
     what to do about it. Nothing here touches the DOM, so the tuning can be
     exercised directly (tests/video-voiceover.spec.js) instead of only
     through a real player on a real network.

     drift > 0 means the audio is behind the video and has to speed up.
  ------------------------------------------------------------------*/
  function correctionFor(audioTime, videoTime, maySeek) {
    var drift = videoTime - audioTime;
    var gap = Math.abs(drift);

    if (gap <= SOFT_TOLERANCE) return { seek: false, rate: 1 };
    if (gap > HARD_TOLERANCE && maySeek) return { seek: true, rate: 1 };

    var span = HARD_TOLERANCE - SOFT_TOLERANCE;
    var trim = Math.min(MAX_RATE_TRIM, ((gap - SOFT_TOLERANCE) / span) * MAX_RATE_TRIM);
    return { seek: false, rate: drift > 0 ? 1 + trim : 1 - trim };
  }

  /* ---------------------------------------------------------------
     Player clock

     getCurrentTime() is answered from the iframe's last reported state. On a
     phone that state can be a beat old and can repeat, so a raw reading is
     used as an anchor and the time between readings is interpolated. A
     repeated reading is treated as stale rather than as a stopped video —
     BUFFERING/PAUSED already tell us when the video really is not moving.
  ------------------------------------------------------------------*/
  function readPlayerTime(entry) {
    if (!entry.player || typeof entry.player.getCurrentTime !== "function") return null;
    try {
      var t = entry.player.getCurrentTime();
      return typeof t === "number" && !isNaN(t) ? t : null;
    } catch (e) {
      return null;
    }
  }

  function sampleClock(entry) {
    var t = readPlayerTime(entry);
    if (t === null) return;
    if (entry.videoPlaying && entry.clockTime !== null && t === entry.clockTime) return;
    entry.clockTime = t;
    entry.clockAt = now();
  }

  function anchorClock(entry) {
    entry.clockTime = null;
    sampleClock(entry);
  }

  function videoTime(entry) {
    if (entry.clockTime === null) return null;
    if (!entry.videoPlaying) return entry.clockTime;
    return entry.clockTime + (now() - entry.clockAt) / 1000;
  }

  function muteVideo(entry) {
    if (entry.player && typeof entry.player.mute === "function") entry.player.mute();
  }

  function unmuteVideo(entry) {
    if (entry.player && typeof entry.player.unMute === "function") entry.player.unMute();
  }

  function pauseVideo(entry) {
    if (entry.player && typeof entry.player.pauseVideo === "function") entry.player.pauseVideo();
  }

  function playVideo(entry) {
    if (entry.player && typeof entry.player.playVideo === "function") entry.player.playVideo();
  }

  /* ---------------------------------------------------------------
     Audio side
  ------------------------------------------------------------------*/

  // preload="none" in the markup keeps a twelve-card page from pulling twelve
  // audio files nobody asked for. The moment a card looks like it will be
  // used — a finger on its toggle, or its video starting — that card's file
  // starts arriving, so the fetch is already in flight when it is needed.
  function warmAudio(entry) {
    if (entry.warmed) return;
    entry.warmed = true;
    try {
      entry.audio.preload = "auto";
      entry.audio.load();
    } catch (e) {
      entry.warmed = false;
    }
  }

  // iOS will not start an <audio> element from a player event; it has to have
  // been started once inside a real gesture. Touching the toggle plays and
  // immediately pauses it, which spends the gesture on unlocking rather than
  // on a play that may not be wanted yet.
  //
  // The unlock is aimed at where the video already is, not at zero: with
  // preload="none" nothing is buffered yet, so this both avoids a blip of the
  // opening line and starts fetching the part of the file about to be played.
  function unlockAudio(entry) {
    if (entry.unlocked) return;
    entry.unlocked = true;
    var wanted = entry.mode === "voiceover";
    if (!wanted) {
      var at = videoTime(entry);
      if (at !== null) seekAudio(entry, at);
    }
    var p = entry.audio.play();
    if (p && typeof p.then === "function") {
      p.then(function () {
        if (!wanted && entry.mode !== "voiceover") entry.audio.pause();
      }).catch(function () {
        // Nothing to recover here: the real play() below reports failures.
      });
    }
  }

  function audioDuration(entry) {
    var d = entry.audio.duration;
    return typeof d === "number" && !isNaN(d) && d > 0 ? d : null;
  }

  function seekAudio(entry, target) {
    var duration = audioDuration(entry);
    if (duration !== null) {
      // A dub shorter than its video would otherwise be seeked past its end
      // over and over, which is a seek storm with nothing to play.
      if (target >= duration) {
        entry.audio.pause();
        return;
      }
      target = Math.max(0, Math.min(target, duration - 0.05));
    } else {
      target = Math.max(0, target);
    }

    entry.lastSeekAt = now();
    if (entry.audio.readyState === 0) {
      entry.pendingSeek = target;
      warmAudio(entry);
      return;
    }
    try {
      entry.audio.currentTime = target;
      entry.pendingSeek = null;
    } catch (e) {
      entry.pendingSeek = target;
    }
  }

  function playAudio(entry) {
    var p = entry.audio.play();
    if (!p || typeof p.catch !== "function") return;
    p.catch(function (err) {
      if (entry.mode !== "voiceover") return;
      if (err && err.name === "NotAllowedError") {
        // Autoplay refused: the toggle would be lying about what is playing.
        setStatus(entry, STATUS_BLOCKED);
        applyMode(entry, "original");
        return;
      }
      // Network or decode trouble — the stall path handles the fallback.
      holdForAudio(entry);
    });
  }

  function syncAndPlayAudio(entry) {
    var t = videoTime(entry);
    seekAudio(entry, t === null ? 0 : t);
    playAudio(entry);
  }

  // Nudge back into place only if the gap is past what a rate trim can close.
  // Seeking whenever the two are "probably" apart is what turns one stall into
  // a stall/seek/stall loop: every seek makes the element wait for bytes
  // again, which looks like another stall to correct.
  function resyncAudio(entry) {
    var v = videoTime(entry);
    if (v === null) return;
    if (Math.abs(entry.audio.currentTime - v) > HARD_TOLERANCE) seekAudio(entry, v);
  }

  // Get the audio going without assuming where it currently is: a fresh start
  // seeks to the video, a running one only closes a real gap.
  function resumeAudio(entry) {
    if (entry.audio.paused) syncAndPlayAudio(entry);
    else resyncAudio(entry);
  }

  /* ---------------------------------------------------------------
     Stalls

     Whichever side runs dry parks the other one. Without this the two just
     slide apart while one of them waits for bytes, and the correction that
     follows is a jump rather than a nudge.
  ------------------------------------------------------------------*/
  function holdForAudio(entry) {
    if (entry.mode !== "voiceover" || entry.holding) return;
    // A seek always waits for bytes on its way through; that is the seek
    // working, not the network failing. Reacting to it would mean parking the
    // video on every correction.
    if (entry.audio.seeking) return;
    // Nothing to park a stalled dub against if the video is not running.
    if (!entry.videoPlaying) return;
    entry.holding = true;
    entry.holdSince = now();
    setState(entry, "buffering");
    setStatus(entry, STATUS_BUFFERING);
    pauseVideo(entry);
  }

  function releaseHold(entry, resumeVideo) {
    if (!entry.holding) return;
    entry.holding = false;
    entry.holdSince = 0;
    setState(entry, null);
    setStatus(entry, "");
    if (resumeVideo !== false) {
      anchorClock(entry);
      resumeAudio(entry);
      playVideo(entry);
    }
  }

  // The audio is not coming. Rather than leave a silent card, hand playback
  // back to the original sound and say so.
  function giveUpOnAudio(entry) {
    // Only start the video again if this card is the reason it stopped — a
    // video the visitor paused themselves stays paused.
    var ourPause = entry.holding;
    releaseHold(entry, false);
    entry.audio.pause();
    applyMode(entry, "original");
    setState(entry, "unavailable");
    setStatus(entry, STATUS_UNAVAILABLE);
    if (ourPause) playVideo(entry);
  }

  /* ---------------------------------------------------------------
     Mode
  ------------------------------------------------------------------*/
  function setState(entry, state) {
    if (state) entry.toggle.setAttribute("data-state", state);
    else entry.toggle.removeAttribute("data-state");
    entry.toggle.setAttribute("aria-busy", state === "buffering" ? "true" : "false");
  }

  function setStatus(entry, text) {
    if (!entry.status) return;
    entry.status.textContent = text || "";
  }

  // One dub at a time: two audio streams over one mobile connection is the
  // congestion this whole file is trying to avoid.
  function stopOtherVoiceovers(entry) {
    entries.forEach(function (other) {
      if (other !== entry && other.mode === "voiceover") applyMode(other, "original");
    });
  }

  function applyMode(entry, mode) {
    entry.mode = mode;
    var isVoiceover = mode === "voiceover";
    entry.toggle.setAttribute("data-mode", mode);
    entry.toggle.setAttribute("aria-pressed", isVoiceover ? "true" : "false");
    entry.toggleLabel.textContent = isVoiceover ? LABEL_VOICEOVER : LABEL_ORIGINAL;

    if (isVoiceover) {
      stopOtherVoiceovers(entry);
      setState(entry, null);
      setStatus(entry, "");
      warmAudio(entry);
      muteVideo(entry);
      anchorClock(entry);
      syncAndPlayAudio(entry);
      startSyncLoop(entry);
    } else {
      entry.holding = false;
      entry.audio.pause();
      entry.audio.playbackRate = 1;
      unmuteVideo(entry);
      stopSyncLoop(entry);
    }
  }

  /* ---------------------------------------------------------------
     Correction loop
  ------------------------------------------------------------------*/
  function stopSyncLoop(entry) {
    if (entry.syncTimer) {
      clearInterval(entry.syncTimer);
      entry.syncTimer = null;
    }
  }

  function startSyncLoop(entry) {
    stopSyncLoop(entry);
    entry.syncTimer = setInterval(function () { tick(entry); }, TICK_MS);
  }

  function tick(entry) {
    if (entry.mode !== "voiceover") {
      stopSyncLoop(entry);
      return;
    }

    if (entry.holding) {
      if (now() - entry.holdSince > STALL_LIMIT_MS) giveUpOnAudio(entry);
      return;
    }

    sampleClock(entry);

    // A stopped video needs no correction; the state handler has already
    // parked the audio next to it.
    if (!entry.videoPlaying) return;
    if (entry.audio.paused || entry.audio.seeking) return;
    if (entry.audio.readyState < 2) return;

    var v = videoTime(entry);
    if (v === null) return;

    var duration = audioDuration(entry);
    if (duration !== null && v >= duration) return; // dub is shorter than the video

    var maySeek = now() - entry.lastSeekAt > SEEK_COOLDOWN_MS;
    var fix = correctionFor(entry.audio.currentTime, v, maySeek);

    if (fix.seek) {
      seekAudio(entry, v);
    } else if (Math.abs(entry.audio.playbackRate - fix.rate) > 0.001) {
      entry.audio.playbackRate = fix.rate;
    }
  }

  /* ---------------------------------------------------------------
     Player events
  ------------------------------------------------------------------*/
  function onPlayerStateChange(entry, event) {
    var YTns = window.YT;
    if (!YTns || !YTns.PlayerState) return;
    var state = event.data;

    if (state === YTns.PlayerState.PLAYING) {
      entry.videoPlaying = true;
      anchorClock(entry);
      warmAudio(entry);
      if (entry.mode === "voiceover" && !entry.holding) {
        resumeAudio(entry);
        startSyncLoop(entry);
      }
      return;
    }

    entry.videoPlaying = false;

    // BUFFERING is the phone case this file exists for: the video has stopped
    // for bytes, so the dub stops with it instead of talking over a frozen
    // frame and then being yanked back.
    if (state === YTns.PlayerState.BUFFERING || state === YTns.PlayerState.PAUSED) {
      sampleClock(entry);
      // A pause we asked for while waiting on audio must not stop that audio
      // buffering — that is the deadlock it would create.
      if (entry.mode === "voiceover" && !entry.holding) entry.audio.pause();
    } else if (state === YTns.PlayerState.ENDED) {
      entry.audio.pause();
      entry.audio.playbackRate = 1;
      seekAudio(entry, 0); // rewind through the guard: nothing may be loaded yet
      stopSyncLoop(entry);
    }
  }

  /* ---------------------------------------------------------------
     YouTube API + lazy player construction
  ------------------------------------------------------------------*/
  var apiLoading = false;
  var apiWaiters = [];

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
    if (entry.player) return;
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

  function ensurePlayer(entry) {
    if (entry.playerRequested) return;
    entry.playerRequested = true;
    if (entry.observer) {
      entry.observer.disconnect();
      entry.observer = null;
    }
    ensureYouTubeApi(function () { createPlayer(entry); });
  }

  function observeForPlayer(entry) {
    if (!("IntersectionObserver" in window)) {
      ensurePlayer(entry);
      return;
    }
    entry.observer = new IntersectionObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].isIntersecting) {
          ensurePlayer(entry);
          return;
        }
      }
    }, { rootMargin: PLAYER_MARGIN });
    entry.observer.observe(entry.wrap);
  }

  /* ---------------------------------------------------------------
     Wiring
  ------------------------------------------------------------------*/
  function bindAudio(entry) {
    var audio = entry.audio;

    // A few percent of rate trim on speech is only inaudible with the pitch
    // held; without this the correction would sound like a chipmunk.
    audio.preservesPitch = true;
    if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;

    audio.addEventListener("loadedmetadata", function () {
      if (entry.pendingSeek !== null) {
        var target = entry.pendingSeek;
        entry.pendingSeek = null;
        seekAudio(entry, target);
      }
    });

    audio.addEventListener("waiting", function () { holdForAudio(entry); });
    audio.addEventListener("stalled", function () { holdForAudio(entry); });
    audio.addEventListener("playing", function () { releaseHold(entry, true); });
    audio.addEventListener("canplaythrough", function () { releaseHold(entry, true); });
    audio.addEventListener("error", function () {
      if (entry.mode === "voiceover") giveUpOnAudio(entry);
    });
    audio.addEventListener("ended", function () { stopSyncLoop(entry); });
  }

  function buildEntry(wrap) {
    var entry = {
      wrap: wrap,
      iframeId: wrap.getAttribute("data-player-id"),
      mode: "original",
      player: null,
      playerRequested: false,
      observer: null,
      syncTimer: null,
      clockTime: null,
      clockAt: 0,
      videoPlaying: false,
      holding: false,
      holdSince: 0,
      lastSeekAt: 0,
      pendingSeek: null,
      warmed: false,
      unlocked: false,
      toggle: wrap.querySelector(".video-voiceover-toggle"),
      audio: wrap.querySelector(".video-voiceover-audio"),
      status: wrap.querySelector(".video-voiceover-status"),
    };
    entry.toggleLabel = entry.toggle.querySelector(".video-voiceover-toggle-label");

    bindAudio(entry);

    // pointerdown, not click: on a phone this fires a beat earlier, so the
    // audio file is already being fetched and the element already unlocked by
    // the time the click lands.
    entry.toggle.addEventListener("pointerdown", function () {
      warmAudio(entry);
      unlockAudio(entry);
    });

    entry.toggle.addEventListener("click", function () {
      // The toggle can be reached before the card ever scrolled far enough to
      // build its player, and without a player there is nothing to mute.
      ensurePlayer(entry);
      warmAudio(entry);
      unlockAudio(entry);
      applyMode(entry, entry.mode === "original" ? "voiceover" : "original");
    });

    observeForPlayer(entry);

    return entry;
  }

  function teardown(entry) {
    stopSyncLoop(entry);
    if (entry.observer) {
      entry.observer.disconnect();
      entry.observer = null;
    }
    // Sorting re-renders the grid; leaving the old players attached to
    // detached iframes leaks a postMessage listener each time.
    if (entry.player && typeof entry.player.destroy === "function") {
      try { entry.player.destroy(); } catch (e) { /* already gone with the DOM */ }
    }
    entry.player = null;
  }

  // Timers are throttled in a hidden tab, so drift builds up unseen. Coming
  // back re-anchors and resyncs once rather than letting the loop discover a
  // huge gap and start seeking.
  function onVisibilityChange() {
    entries.forEach(function (entry) {
      if (entry.mode !== "voiceover") return;
      if (document.hidden) {
        stopSyncLoop(entry);
        return;
      }
      anchorClock(entry);
      entry.lastSeekAt = 0;
      if (entry.videoPlaying && !entry.holding) resumeAudio(entry);
      startSyncLoop(entry);
    });
  }

  function boot() {
    entries.forEach(teardown);
    entries = [].slice.call(document.querySelectorAll(".video-voiceover")).map(buildEntry);
  }

  document.addEventListener("kiddo:rendered", boot);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // The drift maths is the part worth pinning down; exposing it keeps the
  // tuning testable without a live player and a live network.
  window.KiddoVoiceover = {
    correctionFor: correctionFor,
    tuning: {
      softTolerance: SOFT_TOLERANCE,
      hardTolerance: HARD_TOLERANCE,
      maxRateTrim: MAX_RATE_TRIM,
      seekCooldownMs: SEEK_COOLDOWN_MS,
      tickMs: TICK_MS,
      stallLimitMs: STALL_LIMIT_MS,
      playerMargin: PLAYER_MARGIN,
    },
  };
})(window, document);
