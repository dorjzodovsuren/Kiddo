/*
  KidDo — login form handler.

  See the banner in js/auth.js: this signs the visitor in on this device only
  and does not verify the password against anything, because a static site has
  nothing to verify it against.
*/
(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  if (!form || !window.KiddoAuth) return;

  var nameInput = document.getElementById("loginName");
  var passwordInput = document.getElementById("loginPassword");
  var errorBox = document.getElementById("loginError");

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  // Already signed in? Say so rather than asking again.
  if (window.KiddoAuth.isLoggedIn()) {
    form.hidden = true;
    var done = document.createElement("p");
    done.className = "login-already";
    done.innerHTML =
      "Та <b>" + window.KiddoAuth.user() + "</b> нэрээр нэвтэрсэн байна. " +
      '<a href="index.html">Бичлэгүүд рүү очих</a>';
    form.parentNode.insertBefore(done, form);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");

    var result = window.KiddoAuth.login(
      nameInput ? nameInput.value : "",
      passwordInput ? passwordInput.value : ""
    );

    if (!result.ok) {
      showError(result.error);
      return;
    }

    // Send the visitor back where they came from when that was another page
    // on this site, otherwise to the homepage.
    var next = "index.html";
    try {
      var param = new URLSearchParams(window.location.search).get("next");
      // Only same-site relative paths — never an absolute or protocol URL.
      if (param && /^[A-Za-z0-9._-]+\.html$/.test(param)) next = param;
    } catch (err) {
      /* fall through to the default */
    }
    window.location.href = next;
  });
})();
