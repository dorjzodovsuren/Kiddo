/*
  KidDo — client-side viewing gate.

  ⚠️  THIS IS NOT SECURITY.

  The site is static: there is no server, no database and no session to verify
  a password against. Every video id, title and description is already in the
  page source, so anyone can read the "locked" videos by viewing source,
  opening devtools, or turning JavaScript off. This gate only changes what the
  page *shows* by default — it does not protect anything.

  Treat it as a UX device (a preview wall), not as access control. To make the
  restriction real, the locked videos have to be withheld by a server that
  checks a session before sending them, and `authenticate()` below has to call
  that server instead of resolving locally.
*/
(function (window, document) {
  "use strict";

  var STORAGE_KEY = "kiddo.session";

  // How many videos per channel a signed-out visitor may see.
  var PREVIEW_LIMIT = 3;

  /* ---------------------------------------------------------------
     Session (localStorage, best-effort)
  ------------------------------------------------------------------*/

  function readSession() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      // Private mode, disabled storage, or corrupt JSON — treat as signed out.
      return null;
    }
  }

  function writeSession(session) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* nothing we can do */
    }
  }

  /*
    The single seam where real authentication would go. Today it accepts any
    non-empty name and password without checking them against anything,
    because there is nothing to check against — see the banner above.

    Replacing this with `fetch('/api/login', ...)` that returns a session
    token is the whole change on the client side.
  */
  function authenticate(name, password) {
    if (!name || !String(name).trim()) {
      return { ok: false, error: "Нэр эсвэл и-мэйлээ оруулна уу." };
    }
    if (!password || !String(password).trim()) {
      return { ok: false, error: "Нууц үгээ оруулна уу." };
    }
    return { ok: true, session: { name: String(name).trim(), at: Date.now() } };
  }

  var Auth = {
    PREVIEW_LIMIT: PREVIEW_LIMIT,

    isLoggedIn: function () {
      var s = readSession();
      return !!(s && s.name);
    },

    user: function () {
      var s = readSession();
      return s && s.name ? s.name : null;
    },

    login: function (name, password) {
      var result = authenticate(name, password);
      if (result.ok) {
        if (!writeSession(result.session)) {
          return { ok: false, error: "Хөтчийн санах ой боломжгүй байна. Нэвтрэх боломжгүй." };
        }
      }
      return result;
    },

    logout: function () {
      clearSession();
    },
  };

  window.KiddoAuth = Auth;

  /* ---------------------------------------------------------------
     Header control — injected so the four pages stay in sync
  ------------------------------------------------------------------*/

  function buildHeaderLink() {
    var nav = document.querySelector("#mainMenu nav > ul");
    if (!nav) return;

    var existing = nav.querySelector(".auth-nav-item");
    if (existing) existing.parentNode.removeChild(existing);

    var li = document.createElement("li");
    li.className = "auth-nav-item";

    var a = document.createElement("a");
    if (Auth.isLoggedIn()) {
      a.href = "#";
      a.textContent = "Гарах (" + Auth.user() + ")";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        Auth.logout();
        // Signing out is a client-side state change, so re-render in place.
        // A location.reload() here raced the theme's own boot scripts and
        // could leave the page with no JS applied at all.
        buildHeaderLink();
        applyGate();
      });
    } else {
      a.href = "login.html";
      a.textContent = "Нэвтрэх";
    }
    li.appendChild(a);
    nav.appendChild(li);
  }

  /* ---------------------------------------------------------------
     The gate itself
  ------------------------------------------------------------------*/

  // A "channel" is one .post-item on the homepage, or the whole .video-grid
  // on a dedicated channel page.
  function channelGroups() {
    var posts = [].slice.call(document.querySelectorAll(".post-item"));
    if (posts.length) {
      return posts.map(function (p) {
        return { root: p, cards: [].slice.call(p.querySelectorAll(".portfolio-item")) };
      });
    }
    var grid = document.querySelector(".video-grid");
    if (grid) {
      return [{ root: grid, cards: [].slice.call(grid.querySelectorAll(".video-card")) }];
    }
    return [];
  }

  function lockedNotice(hiddenCount) {
    var box = document.createElement("div");
    box.className = "video-locked-notice";
    box.innerHTML =
      '<svg class="video-locked-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
      '<rect x="4" y="10" width="16" height="10" rx="2"></rect>' +
      '<path d="M8 10V7a4 4 0 0 1 8 0v3"></path>' +
      "</svg>" +
      "<p class=\"video-locked-text\">Энэ сувгийн бусад <b>" + hiddenCount +
      "</b> бичлэгийг үзэхийн тулд нэвтэрнэ үү.</p>" +
      '<a class="btn btn-channel-more" href="login.html">Нэвтрэх</a>';
    return box;
  }

  function applyGate() {
    var open = Auth.isLoggedIn();
    document.body.classList.toggle("is-signed-in", open);
    document.body.classList.toggle("is-signed-out", !open);

    channelGroups().forEach(function (group) {
      // DOM order is treated as newest-first, so the preview is the first N.
      var hidden = 0;
      group.cards.forEach(function (card, i) {
        var locked = !open && i >= PREVIEW_LIMIT;
        card.classList.toggle("is-locked", locked);
        if (locked) hidden++;
      });

      // Remove only *this* group's notice. The homepage's three .post-item
      // blocks share one parent, so a parent-wide querySelector would find and
      // delete a sibling channel's notice instead of its own.
      var next = group.root.nextElementSibling;
      if (next && next.classList.contains("video-locked-notice")) {
        next.parentNode.removeChild(next);
      }

      if (hidden > 0) {
        group.root.parentNode.insertBefore(lockedNotice(hidden), group.root.nextSibling);
      }
    });

    // Let the search know the locked set changed.
    document.dispatchEvent(new CustomEvent("kiddo:gatechange"));
  }

  Auth.applyGate = applyGate;

  function init() {
    buildHeaderLink();
    applyGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
