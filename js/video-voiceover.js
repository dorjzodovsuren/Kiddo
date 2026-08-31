/*
  KidDo — voice-over playback.

  Each video card (built by js/video-data.js) carries a toggle button, a
  settings panel for entering a voice-over audio URL or file, and a hidden
  <audio> element. This file wires all three together:

    - "Эх дуу" / "Оруулсан дуу" toggle mutes the YouTube player and plays the
      voice-over audio in sync, or the reverse.
    - The settings panel saves the entered URL to localStorage, keyed per
      video, so it survives a reload. A locally chosen file plays for the
      current visit only (there is nowhere to upload it to).
    - While the voice-over is playing, a short interval nudges the audio back
      in step with the video's current time to correct drift from network
      jitter — YouTube's API does not emit a "seeked" event to react to
      directly.

  Waits for the same "kiddo:rendered" event video-search.js uses, since cards
  are rendered from JSON after this script loads.
*/
(function (window, document) {
  "use strict";

  var STORAGE_PREFIX = "kiddo:voiceover:";
  var DRIFT_TOLERANCE = 0.4;
  var entries = [];
  var apiLoading = false;
  var apiWaiters = [];

  function storageKey(key) {
    return STORAGE_PREFIX + key;
  }

  function readStored(key) {
    try {
      return window.localStorage.getItem(storageKey(key));
    } catch (e) {
      return null;
    }
  }

  function writeStored(key, value) {
    try {
      window.localStorage.setItem(storageKey(key), value);
    } catch (e) {
      // Storage may be unavailable (private mode, quota). The audio still
      // plays for the current session even if it cannot be remembered.
    }
  }

  function setStatus(entry, text, isError) {
    entry.status.textContent = text;
    entry.status.classList.toggle("is-error", !!isError);
  }

  function openPanel(entry) {
    entry.panel.hidden = false;
    entry.settingsBtn.setAttribute("aria-expanded", "true");
  }

  function closePanel(entry) {
    entry.panel.hidden = true;
    entry.settingsBtn.setAttribute("aria-expanded", "false");
  }

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
    if (!entry.audio.src) return;
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

  function setVoiceoverSource(entry, src, persist) {
    entry.audio.src = src;
    entry.urlInput.value = src;
    if (persist) writeStored(entry.key, src);
    if (entry.mode === "voiceover") syncAndPlayAudio(entry);
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
      key: wrap.getAttribute("data-voiceover-key"),
      iframeId: wrap.getAttribute("data-player-id"),
      mode: "original",
      player: null,
      syncTimer: null,
      toggle: wrap.querySelector(".video-voiceover-toggle"),
      settingsBtn: wrap.querySelector(".video-voiceover-settings"),
      panel: wrap.querySelector(".video-voiceover-panel"),
      urlInput: wrap.querySelector(".video-voiceover-url"),
      saveBtn: wrap.querySelector(".video-voiceover-save"),
      fileInput: wrap.querySelector(".video-voiceover-file"),
      status: wrap.querySelector(".video-voiceover-status"),
      audio: wrap.querySelector(".video-voiceover-audio"),
    };
    entry.toggleLabel = entry.toggle.querySelector(".video-voiceover-toggle-label");

    var initial = readStored(entry.key) || wrap.getAttribute("data-voiceover-default") || "";
    if (initial) {
      entry.audio.src = initial;
      entry.urlInput.value = initial;
      setStatus(entry, "Дуу тохируулагдсан.", false);
    }

    entry.toggle.addEventListener("click", function () {
      if (entry.mode === "original") {
        if (!entry.audio.src) {
          openPanel(entry);
          entry.urlInput.focus();
          setStatus(entry, "Эхлээд дуу оруулах холбоос эсвэл файл нэмнэ үү.", true);
          return;
        }
        applyMode(entry, "voiceover");
      } else {
        applyMode(entry, "original");
      }
    });

    entry.settingsBtn.addEventListener("click", function () {
      if (entry.panel.hidden) openPanel(entry);
      else closePanel(entry);
    });

    entry.saveBtn.addEventListener("click", function () {
      var value = entry.urlInput.value.trim();
      if (!value) {
        setStatus(entry, "Холбоос хоосон байна.", true);
        return;
      }
      setVoiceoverSource(entry, value, true);
      setStatus(entry, "Дуу хадгалагдлаа.", false);
    });

    entry.fileInput.addEventListener("change", function () {
      var file = entry.fileInput.files && entry.fileInput.files[0];
      if (!file) return;
      entry.urlInput.value = "";
      entry.audio.src = URL.createObjectURL(file);
      if (entry.mode === "voiceover") syncAndPlayAudio(entry);
      setStatus(entry, "«" + file.name + "» сонгогдлоо (зөвхөн энэ удаагийн үзэлтэд).", false);
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
