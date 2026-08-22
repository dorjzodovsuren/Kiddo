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

  function videoCard(video, channel, expandable) {
    var card = el("article", "video-card");
    card.setAttribute("data-video-title", video.title);
    card.setAttribute("data-video-channel", channel.name);

    var frame = el("div", "video-card-frame");
    var iframe = document.createElement("iframe");
    iframe.src = video.url;
    iframe.title = video.title;
    iframe.loading = "lazy";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    );
    iframe.setAttribute("allowfullscreen", "");
    frame.appendChild(iframe);
    card.appendChild(frame);

    var body = el("div", "video-card-body");
    body.appendChild(el("h3", "video-card-title", video.title));

    if (expandable) {
      body.appendChild(descriptionCarousel(video));
    } else {
      body.appendChild(el("p", "video-card-summary", video.summary));
    }

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
    var list = limit ? channel.videos.slice(0, limit) : channel.videos;
    list.forEach(function (v) {
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

  function render(container, channels, limit, expandable) {
    container.innerHTML = "";
    channels.forEach(function (channel) {
      container.appendChild(channelBlock(channel, limit, expandable));
    });
    document.dispatchEvent(new CustomEvent("kiddo:rendered"));
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

    Promise.all(
      slugs.map(function (slug) {
        return fetch("data/" + slug + ".json").then(function (res) {
          if (!res.ok) throw new Error(slug + ": HTTP " + res.status);
          return res.json();
        });
      })
    )
      .then(function (channels) {
        render(container, channels, limit, expandable);
      })
      .catch(function (err) {
        container.innerHTML = "";
        var msg = el(
          "p",
          "video-load-error",
          "Бичлэгийн мэдээллийг ачаалж чадсангүй. Хуудсыг сервер дээр нээж үзнэ үү."
        );
        container.appendChild(msg);
        if (window.console) window.console.error("[kiddo] video data failed:", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
