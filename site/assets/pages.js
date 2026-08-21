/* yt-dlp Studio — subpage script (features / download / building / faq / roadmap).
   Self-contained: no network requests, no external libraries. Provides a local
   non-blocking toast region and working copy-to-clipboard buttons for the command
   rows on the "building from source" page. Everything else on these pages (theme
   toggle, mobile menu, the header search box and its anchored regex builder) is
   handled by the already-shipped assets/app.js, loaded alongside this file. */
(function () {
  "use strict";

  function toast(message, timeout) {
    var region = document.querySelector(".pg-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "pg-toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    var el = document.createElement("div");
    el.className = "pg-toast";
    el.textContent = message;
    region.appendChild(el);
    requestAnimationFrame(function () {
      el.setAttribute("data-shown", "true");
    });
    window.setTimeout(function () {
      el.setAttribute("data-shown", "false");
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }, timeout || 3200);
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand && document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    done(!!ok);
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { fallbackCopy(text, done); }
      );
    } else {
      fallbackCopy(text, done);
    }
  }

  function initCopyButtons() {
    var buttons = document.querySelectorAll("[data-copy-text]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy-text") || "";
        var label = btn.getAttribute("data-copy-label") || "Command";
        copyText(text, function (ok) {
          btn.setAttribute("data-copied", ok ? "true" : "false");
          toast(ok ? label + " copied to clipboard." : "Could not copy automatically — select the line and press Ctrl+C.");
          window.setTimeout(function () { btn.removeAttribute("data-copied"); }, 1800);
        });
      });
    });
  }

  /* Reduced-motion guard: skip the slide-in transform entirely, handled purely
     in CSS via prefers-reduced-motion, so no JS branch is needed here beyond
     not fighting it — kept out of the way deliberately. */

  document.addEventListener("DOMContentLoaded", function () {
    initCopyButtons();
  });
})();
