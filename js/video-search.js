/*
  KidDo — keyword search for video collections.

  Works on both page shapes without configuration:
    - index.html   : filters the theme's .portfolio-item cards
    - channel-*.html: filters the .video-card grid

  Matching is accent-insensitive on case and searches the card's full visible
  text (title, summary and the question prompts), so a viewer can type either a
  title word or something from the description.
*/
(function () {
  "use strict";

  var input = document.getElementById("videoSearch");
  if (!input) return;

  var wrap = input.closest(".video-search-wrap") || document;
  var clearBtn = wrap.querySelector(".video-search-clear");
  var status = wrap.querySelector(".video-search-status");
  var empty = document.querySelector(".video-search-empty");

  // Cards to filter, plus the group each belongs to so a channel whose cards
  // are all filtered out can be hidden along with its heading.
  var cards = [].slice.call(document.querySelectorAll(".video-card, .portfolio-item"));
  if (!cards.length) return;

  var haystacks = cards.map(function (card) {
    return (card.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
  });

  // On index.html each channel is a .post-item containing its own grid.
  var groups = [].slice.call(document.querySelectorAll(".post-item"));

  function apply() {
    var q = input.value.toLowerCase().replace(/\s+/g, " ").trim();
    var terms = q ? q.split(" ") : [];
    var shown = 0;

    cards.forEach(function (card, i) {
      var hay = haystacks[i];
      var hit = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      card.hidden = !hit;
      card.style.display = hit ? "" : "none";
      if (hit) shown++;
    });

    // Hide a channel block entirely when none of its cards matched.
    groups.forEach(function (group) {
      var any = [].slice
        .call(group.querySelectorAll(".video-card, .portfolio-item"))
        .some(function (c) { return c.style.display !== "none"; });
      group.style.display = any ? "" : "none";
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

  // Enter should not submit anything (the label is not a form).
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

  apply();
})();
