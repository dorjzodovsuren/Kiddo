/*
  KidDo — renders every video card from the per-channel JSON files.

  One file per channel lives in data/<slug>.json and is the single source for
  the video url, title and description text. Nothing about a video is written
  into the HTML by hand.

  Note: this uses fetch(), so the pages must be served over http(s). Opening
  index.html straight off disk (file://) is blocked by the browser's CORS rules
  and the grids will report that they could not load.

  A page declares what it wants with data attributes on the container:
    <div class="video-collection" data-channels="nutshell,brainscoop,..." data-limit="3">
    <div class="video-collection" data-channels="nutshell" data-expandable="true">
*/
(function (window, document) {
  "use strict";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // enablejsapi + origin let js/video-voiceover.js drive the player through
  // the official YouTube IFrame Player API (mute/unmute, play state) so it
  // can keep a separate voice-over audio track in sync with it.
  function withPlayerApi(url) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return url + sep + "enablejsapi=1&origin=" + encodeURIComponent(window.location.origin);
  }

  // The voice-over track comes only from the channel's own JSON — there is
  // no upload path and nothing is remembered per-visitor. A video without a
  // "voiceover" url simply has no toggle: there is nothing for it to switch to.
  function voiceoverBlock(video, iframeId) {
    if (!video.voiceover) return null;

    var wrap = el("div", "video-voiceover");
    wrap.setAttribute("data-player-id", iframeId);

    var toggle = el("button", "video-voiceover-toggle");
    toggle.type = "button";
    toggle.setAttribute("data-mode", "original");
    toggle.setAttribute("aria-pressed", "false");
    toggle.appendChild(el("span", "video-voiceover-toggle-label", "Эх дуу"));
    wrap.appendChild(toggle);

    var audio = document.createElement("audio");
    audio.className = "video-voiceover-audio";
    audio.preload = "none";
    audio.src = video.voiceover;
    wrap.appendChild(audio);

    return wrap;
  }

  function videoCard(video, channel, expandable) {
    var card = el("article", "video-card");
    card.setAttribute("data-video-title", video.title);
    card.setAttribute("data-video-channel", channel.name);

    var iframeId = "ytp-" + channel.slug + "-" + video.id;

    var frame = el("div", "video-card-frame");
    var iframe = document.createElement("iframe");
    iframe.id = iframeId;
    iframe.src = withPlayerApi(video.url);
    iframe.title = video.title;
    iframe.loading = "lazy";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    );
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("data-yt-player", "true");
    frame.appendChild(iframe);
    card.appendChild(frame);

    var body = el("div", "video-card-body");
    body.appendChild(el("h3", "video-card-title", video.title));

    if (expandable) {
      body.appendChild(descriptionCarousel(video));
    } else {
      body.appendChild(el("p", "video-card-summary", video.summary));
    }

    var voiceover = voiceoverBlock(video, iframeId);
    if (voiceover) body.appendChild(voiceover);

    card.appendChild(body);
    return card;
  }

  /*
    The description on a channel page is a small carousel: the first slide is
    the summary, each following slide is one of the video's questions. Clicking
    it expands the card so the whole description and every question are shown
    at once; clicking again collapses back to the carousel.
  */
  function descriptionCarousel(video) {
    var slides = [{ kind: "summary", text: video.summary }].concat(
      (video.questions || []).map(function (q) {
        return { kind: "question", text: q };
      })
    );

    var wrap = el("div", "video-desc");
    wrap.setAttribute("data-slides", String(slides.length));

    var viewport = el("div", "video-desc-viewport");
    var track = el("div", "video-desc-track");

    slides.forEach(function (slide) {
      var s = el("p", "video-desc-slide video-desc-" + slide.kind, slide.text);
      track.appendChild(s);
    });
    viewport.appendChild(track);
    wrap.appendChild(viewport);

    // Full text, revealed when expanded.
    var full = el("div", "video-desc-full");
    full.appendChild(el("p", "video-desc-summary-full", video.summary));
    if (video.questions && video.questions.length) {
      var ul = el("ul", "video-desc-questions");
      video.questions.forEach(function (q) {
        ul.appendChild(el("li", null, q));
      });
      full.appendChild(ul);
    }
    wrap.appendChild(full);

    var controls = el("div", "video-desc-controls");

    var prev = el("button", "video-desc-nav video-desc-prev");
    prev.type = "button";
    prev.setAttribute("aria-label", "Өмнөх");
    prev.innerHTML = "&#8249;";

    var dots = el("div", "video-desc-dots");
    slides.forEach(function (_, i) {
      var dot = el("button", "video-desc-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", "Хэсэг " + (i + 1));
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        go(i);
      });
      dots.appendChild(dot);
    });

    var next = el("button", "video-desc-nav video-desc-next");
    next.type = "button";
    next.setAttribute("aria-label", "Дараах");
    next.innerHTML = "&#8250;";

    controls.appendChild(prev);
    controls.appendChild(dots);
    controls.appendChild(next);
    wrap.appendChild(controls);

    var hint = el("button", "video-desc-toggle");
    hint.type = "button";
    hint.textContent = "Дэлгэрэнгүй";
    hint.setAttribute("aria-expanded", "false");
    wrap.appendChild(hint);

    var index = 0;

    function go(i) {
      index = (i + slides.length) % slides.length;
      track.style.transform = "translateX(" + (-index * 100) + "%)";
      [].forEach.call(dots.children, function (d, di) {
        d.classList.toggle("is-active", di === index);
      });
    }

    function setExpanded(open) {
      wrap.classList.toggle("is-expanded", open);
      hint.setAttribute("aria-expanded", open ? "true" : "false");
      hint.textContent = open ? "Хураах" : "Дэлгэрэнгүй";
    }

    prev.addEventListener("click", function (e) { e.stopPropagation(); go(index - 1); });
    next.addEventListener("click", function (e) { e.stopPropagation(); go(index + 1); });

    hint.addEventListener("click", function (e) {
      e.stopPropagation();
      setExpanded(!wrap.classList.contains("is-expanded"));
    });

    // Clicking the description itself expands it, as requested.
    viewport.addEventListener("click", function () {
      setExpanded(!wrap.classList.contains("is-expanded"));
    });

    go(0);
    setExpanded(false);
    return wrap;
  }

  function channelBlock(channel, limit, expandable) {
    var block = el("section", "video-channel");
    block.setAttribute("data-channel", channel.slug);

    var head = el("div", "video-channel-head");
    var title = el("h3", "video-channel-name");
    var link = el("a", null, channel.name);
    link.href = channel.page;
    title.appendChild(link);
    head.appendChild(title);
    block.appendChild(head);

    var grid = el("div", "video-grid");
    orderedVideos(channel, limit, state.sort).forEach(function (v) {
      grid.appendChild(videoCard(v, channel, expandable));
    });
    block.appendChild(grid);

    if (limit && channel.videos.length > limit) {
      var more = el("div", "video-channel-more");
      var a = el("a", "btn btn-channel-more", channel.name + "-н бүх дугаар");
      a.href = channel.page;
      more.appendChild(a);
      block.appendChild(more);
    }

    return block;
  }

  /* ---------------------------------------------------------------
     Loading — always fetch the freshest copy

     The JSON is content the site owner replaces; a cached copy means an
     upload silently does not show up. Two things force a fresh read: the
     no-store hint bypasses the browser's HTTP cache, and the unique query
     string makes it a URL no CDN (GitHub Pages included) has seen before, so
     it cannot answer from its edge cache either. These files are a few KB,
     so re-fetching per page load is cheap.
  ------------------------------------------------------------------*/
  function loadChannel(slug) {
    var url = "data/" + slug + ".json?t=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        // .json() on malformed content rejects with a parse error; surface the
        // channel name with it so a hand-edited file is easy to track down.
        return res.json();
      })
      .then(function (channel) {
        return { ok: true, slug: slug, channel: channel };
      })
      .catch(function (err) {
        // One unreadable file must not take the whole page down with it — a
        // stray quote in one channel's JSON used to blank every channel.
        if (window.console) {
          window.console.error("[kiddo] data/" + slug + ".json could not be read:", err);
        }
        return { ok: false, slug: slug, error: err };
      });
  }

  /* ---------------------------------------------------------------
     Sorting by upload date

     Each video may carry a "published" date (ISO "YYYY-MM-DD"). When every
     video in a channel has one, that is what the sort uses. When any is
     missing, the sort falls back to the order the videos appear in the JSON,
     which the file documents as newest first. So the control works today and
     becomes exact the moment real dates are filled in — it never invents one.
  ------------------------------------------------------------------*/
  var SORT_NEWEST = "newest";
  var SORT_OLDEST = "oldest";

  var state = {
    channels: [],
    container: null,
    limit: 0,
    expandable: false,
    sort: SORT_NEWEST,
  };

  function publishedTime(video) {
    if (!video || !video.published) return null;
    var t = Date.parse(video.published);
    return isNaN(t) ? null : t;
  }

  function hasFullDates(videos) {
    return videos.length > 0 && videos.every(function (v) { return publishedTime(v) !== null; });
  }

  // Newest-first list for a channel, whatever the source ordering.
  function newestFirst(videos) {
    if (!hasFullDates(videos)) return videos.slice();
    return videos.slice().sort(function (a, b) {
      return publishedTime(b) - publishedTime(a);
    });
  }

  function orderedVideos(channel, limit, sort) {
    // Pick which videos to show *before* applying the display order, so a
    // homepage limited to 3 always shows the newest 3 — sorting reorders
    // them, it does not swap in older ones.
    var newest = newestFirst(channel.videos);
    var chosen = limit ? newest.slice(0, limit) : newest;
    return sort === SORT_OLDEST ? chosen.slice().reverse() : chosen;
  }

  function render(container, channels, limit, expandable) {
    container.innerHTML = "";
    channels.forEach(function (channel) {
      container.appendChild(channelBlock(channel, limit, expandable));
    });

    // Name any channel whose file could not be read, so a broken upload is
    // visible on the page instead of the channel just quietly vanishing.
    (state.failed || []).forEach(function (f) {
      container.appendChild(
        el(
          "p",
          "video-load-error",
          "«" + f.slug + "» сувгийн мэдээллийг уншиж чадсангүй (data/" + f.slug + ".json)."
        )
      );
    });

    document.dispatchEvent(new CustomEvent("kiddo:rendered"));
  }

  function rerender() {
    render(state.container, state.channels, state.limit, state.expandable);
  }

  function buildSortControl() {
    var wrap = document.querySelector(".video-search-wrap");
    if (!wrap || wrap.querySelector(".video-sort")) return;

    var row = wrap.querySelector(".video-search-row") || wrap;

    var btn = el("button", "video-sort");
    btn.type = "button";

    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "video-sort-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<line x1="5" y1="6" x2="15" y2="6"></line>' +
      '<line x1="5" y1="12" x2="12" y2="12"></line>' +
      '<line x1="5" y1="18" x2="9" y2="18"></line>' +
      '<polyline points="17 9 20 6 20 18"></polyline>';
    btn.appendChild(icon);

    var label = el("span", "video-sort-label");
    btn.appendChild(label);

    function paint() {
      var newest = state.sort === SORT_NEWEST;
      label.textContent = newest ? "Шинэ эхэндээ" : "Хуучин эхэндээ";
      btn.setAttribute("aria-label", "Огноогоор эрэмбэлэх: " + label.textContent);
      btn.setAttribute("data-sort", state.sort);
      btn.classList.toggle("is-oldest", !newest);
    }

    btn.addEventListener("click", function () {
      state.sort = state.sort === SORT_NEWEST ? SORT_OLDEST : SORT_NEWEST;
      paint();
      rerender();
    });

    paint();
    row.appendChild(btn);
  }

  function boot() {
    var container = document.querySelector(".video-collection");
    if (!container) return;

    var slugs = (container.getAttribute("data-channels") || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (!slugs.length) return;

    var limitAttr = container.getAttribute("data-limit");
    var limit = limitAttr ? parseInt(limitAttr, 10) : 0;
    var expandable = container.getAttribute("data-expandable") === "true";

    Promise.all(slugs.map(loadChannel)).then(function (results) {
      var ok = results.filter(function (r) { return r.ok; });
      var failed = results.filter(function (r) { return !r.ok; });

      state.channels = ok.map(function (r) { return r.channel; });
      state.container = container;
      state.limit = limit;
      state.expandable = expandable;
      state.failed = failed;

      if (!ok.length) {
        container.innerHTML = "";
        container.appendChild(
          el(
            "p",
            "video-load-error",
            "Бичлэгийн мэдээллийг ачаалж чадсангүй. Хуудсыг сервер дээр нээж үзнэ үү."
          )
        );
        return;
      }

      buildSortControl();
      render(container, state.channels, limit, expandable);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
