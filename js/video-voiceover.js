/*
  KidDo — voice-over playback.

  Each video card that has a "voiceover" url in its channel's JSON (built by
  js/video-data.js) carries one toggle button and a hidden <audio> element
  already pointed at that url — there is no upload path and nothing is saved
  per-visitor, so this file only has to wire the toggle up:

    - "Эх дуу" / "Оруулсан дуу" mutes the YouTube player and plays the
      voice-over audio in sync with it, or the reverse.
    - While the voice-over is playing, a short interval nudges the audio back
      in step with the video's current time to correct drift from network
      jitter — YouTube's API does not emit a "seeked" event to react to
      directly.

  Waits for the same "kiddo:rendered" event video-search.js uses, since cards
  are rendered from JSON after this script loads.
*/
(function (window, document) {
  "use strict";

  var DRIFT_TOLERANCE = 0.4;
  var entries = [];
  var apiLoading = false;
  var apiWaiters = [];

  function getPlayerTime(entry) {
    return entry.player && typeof entry.player.getCurrentTime === "function"
      ? entry.player.getCurrentTime()
      : 0;
  }

  function muteVideo(entry) {
    if (entry.player && typeof entry.player.mute === "function") entry.player.mute();
  }

  function unmuteVideo(entry) {
    if (entry.player && typeof entry.player.unMute === "function") entry.player.unMute();
  }

  function syncAndPlayAudio(entry) {
    entry.audio.currentTime = getPlayerTime(entry);
    entry.audio.play().catch(function () {
      // Autoplay can be refused outside a user gesture; the toggle click that
      // reaches here is itself a gesture, so this is only a safety net.
    });
  }

  function stopSyncLoop(entry) {
    if (entry.syncTimer) {
      clearInterval(entry.syncTimer);
      entry.syncTimer = null;
    }
  }

  function startSyncLoop(entry) {
    stopSyncLoop(entry);
    entry.syncTimer = setInterval(function () {
      if (entry.mode !== "voiceover") return;
      var drift = Math.abs(entry.audio.currentTime - getPlayerTime(entry));
      if (drift > DRIFT_TOLERANCE) entry.audio.currentTime = getPlayerTime(entry);
    }, 500);
  }

  function applyMode(entry, mode) {
    entry.mode = mode;
    var isVoiceover = mode === "voiceover";
    entry.toggle.setAttribute("data-mode", mode);
    entry.toggle.setAttribute("aria-pressed", isVoiceover ? "true" : "false");
    entry.toggleLabel.textContent = isVoiceover ? "Оруулсан дуу" : "Эх дуу";

    if (isVoiceover) {
      muteVideo(entry);
      syncAndPlayAudio(entry);
    } else {
      unmuteVideo(entry);
      entry.audio.pause();
    }
  }

  function onPlayerStateChange(entry, event) {
    var YTns = window.YT;
    if (!YTns) return;
    if (event.data === YTns.PlayerState.PLAYING) {
      if (entry.mode === "voiceover") syncAndPlayAudio(entry);
      startSyncLoop(entry);
    } else if (event.data === YTns.PlayerState.PAUSED) {
      if (entry.mode === "voiceover") entry.audio.pause();
      stopSyncLoop(entry);
    } else if (event.data === YTns.PlayerState.ENDED) {
      entry.audio.pause();
      entry.audio.currentTime = 0;
      stopSyncLoop(entry);
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

  function buildEntry(wrap) {
    var entry = {
      wrap: wrap,
      iframeId: wrap.getAttribute("data-player-id"),
      mode: "original",
      player: null,
      syncTimer: null,
      toggle: wrap.querySelector(".video-voiceover-toggle"),
      audio: wrap.querySelector(".video-voiceover-audio"),
    };
    entry.toggleLabel = entry.toggle.querySelector(".video-voiceover-toggle-label");

    entry.toggle.addEventListener("click", function () {
      applyMode(entry, entry.mode === "original" ? "voiceover" : "original");
    });

    ensureYouTubeApi(function () { createPlayer(entry); });

    return entry;
  }

  function boot() {
    entries.forEach(stopSyncLoop);
    entries = [].slice.call(document.querySelectorAll(".video-voiceover")).map(buildEntry);
  }

  document.addEventListener("kiddo:rendered", boot);
})(window, document);
