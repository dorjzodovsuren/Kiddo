/*
  KidDo — keyword search for video collections.

  The cards are rendered from JSON by video-data.js, so this waits for the
  "kiddo:rendered" event before binding and re-reads the cards each time the
  collection is rebuilt.

  Visibility is expressed with a class (.is-filtered) rather than an inline
  style, so the rule lives in one place in the stylesheet.
*/
(function () {
  "use strict";

  var input = document.getElementById("videoSearch");
  if (!input) return;

  var wrap = input.closest(".video-search-wrap") || document;
  var clearBtn = wrap.querySelector(".video-search-clear");
  var status = wrap.querySelector(".video-search-status");
  var empty = document.querySelector(".video-search-empty");

  var cards = [];
  var haystacks = [];
  var channels = [];

  function collect() {
    cards = [].slice.call(document.querySelectorAll(".video-card"));
    haystacks = cards.map(function (card) {
      return (card.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
    });
    channels = [].slice.call(document.querySelectorAll(".video-channel"));
  }

  function apply() {
    var q = input.value.toLowerCase().replace(/\s+/g, " ").trim();
    var terms = q ? q.split(" ") : [];
    var shown = 0;

    cards.forEach(function (card, i) {
      var hay = haystacks[i];
      var hit = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      card.classList.toggle("is-filtered", !hit);
      if (hit) shown++;
    });

    // Hide a channel block entirely when none of its cards are showing.
    channels.forEach(function (channel) {
      var any = [].slice
        .call(channel.querySelectorAll(".video-card"))
        .some(function (c) { return !c.classList.contains("is-filtered"); });
      channel.classList.toggle("is-filtered", !any);
    });

    if (clearBtn) clearBtn.hidden = !terms.length;
    if (empty) empty.hidden = !(terms.length && shown === 0);

    if (status) {
      if (!terms.length) status.textContent = "";
      else if (shown === 0) status.textContent = "Бичлэг олдсонгүй";
      else status.textContent = shown + " бичлэг олдлоо";
    }
  }

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 120);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") e.preventDefault();
    if (e.key === "Escape") { input.value = ""; apply(); }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      input.value = "";
      apply();
      input.focus();
    });
  }

  // The collection is rendered asynchronously from JSON.
  document.addEventListener("kiddo:rendered", function () {
    collect();
    apply();
  });

  collect();
  apply();
})();
