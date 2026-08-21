// yt-dlp Studio site — shared behaviour. Vanilla JS, no build step, no dependencies.
(function () {
  "use strict";

  /* ---------------- Toasts ---------------- */

  function ensureToastRegion() {
    var region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    return region;
  }

  function toast(message, timeout) {
    var region = ensureToastRegion();
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    region.appendChild(el);
    window.setTimeout(function () {
      el.remove();
    }, timeout || 3200);
  }
  window.ytdlpToast = toast;

  /* ---------------- Theme toggle ---------------- */

  var THEME_KEY = "ytdlp-studio-theme"; // "light" | "dark" | absent = follow system

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) {
      var current = theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      btn.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
      btn.setAttribute("aria-label", current === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
  }

  function initTheme() {
    var stored = null;
    try { stored = window.localStorage.getItem(THEME_KEY); } catch (e) { /* storage unavailable */ }
    applyTheme(stored);

    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var root = document.documentElement;
      var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var effective = root.getAttribute("data-theme") || (systemDark ? "dark" : "light");
      var next = effective === "dark" ? "light" : "dark";
      applyTheme(next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      toast(next === "dark" ? "Dark theme on." : "Light theme on.");
    });
  }

  /* ---------------- Tabs (role=tablist) ---------------- */

  function initTabs() {
    var strips = document.querySelectorAll("[data-tablist]");
    strips.forEach(function (strip) {
      var tabs = Array.prototype.slice.call(strip.querySelectorAll('[role="tab"]'));
      if (!tabs.length) return;

      function select(tab, focus) {
        tabs.forEach(function (t) {
          var selected = t === tab;
          t.setAttribute("aria-selected", selected ? "true" : "false");
          t.tabIndex = selected ? 0 : -1;
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !selected;
        });
        if (focus) {
          tab.focus();
          // A keyboard-focused tab can sit outside the horizontally
          // scrollable strip on a narrow screen — bring it into view
          // rather than leaving it reachable-but-invisible.
          var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (tab.scrollIntoView) {
            tab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
          }
        }
      }

      tabs.forEach(function (tab, i) {
        tab.addEventListener("click", function () { select(tab, false); });
        tab.addEventListener("keydown", function (ev) {
          var idx = i;
          if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
            idx = (i + 1) % tabs.length;
          } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
            idx = (i - 1 + tabs.length) % tabs.length;
          } else if (ev.key === "Home") {
            idx = 0;
          } else if (ev.key === "End") {
            idx = tabs.length - 1;
          } else {
            return;
          }
          ev.preventDefault();
          select(tabs[idx], true);
        });
      });
    });
  }

  /* ---------------- Command planner ---------------- */

  function quoteIfNeeded(value) {
    if (!value) return value;
    if (/[\s"']/.test(value)) {
      return '"' + value.replace(/"/g, '\\"') + '"';
    }
    return value;
  }

  function buildCommand(form) {
    var url = form.querySelector('[name="media-url"]').value.trim();
    var outputPref = form.querySelector('[name="output-pref"]').value;
    var subs = form.querySelector('[name="subs"]').value;
    var template = form.querySelector('[name="output-template"]').value.trim();

    var parts = ["yt-dlp"];

    if (outputPref === "best-video") {
      parts.push("-f", "bestvideo+bestaudio/best");
    } else if (outputPref === "audio-only") {
      parts.push("-x", "--audio-format", "mp3");
    } else if (outputPref === "smallest") {
      parts.push("-f", "worst");
    }
    // "recommended" adds no explicit -f flag; yt-dlp's own default applies.

    if (subs === "embed") {
      parts.push("--write-subs", "--embed-subs");
    } else if (subs === "download") {
      parts.push("--write-subs", "--sub-langs", "en");
    }
    // "none" adds nothing.

    if (template) {
      parts.push("-o", quoteIfNeeded(template));
    }

    if (url) {
      parts.push(quoteIfNeeded(url));
    } else {
      parts.push("<media URL>");
    }

    return parts.join(" ");
  }

  function initPlanner() {
    var form = document.querySelector("[data-planner-form]");
    if (!form) return;
    var draft = form.querySelector("[data-draft-command]");

    function refresh() {
      draft.value = buildCommand(form);
    }

    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    refresh();

    var copyBtn = form.querySelector("[data-copy-command]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = draft.value;
        var done = function (ok) {
          toast(ok ? "Draft command copied to clipboard." : "Could not copy automatically — the text is selected, so press Ctrl+C.");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () {
            fallbackCopy(draft, done);
          });
        } else {
          fallbackCopy(draft, done);
        }
      });
    }

    function fallbackCopy(textarea, done) {
      try {
        textarea.focus();
        textarea.select();
        var ok = document.execCommand && document.execCommand("copy");
        done(!!ok);
      } catch (e) {
        done(false);
      }
    }
  }

  /* ---------------- Page content index (for search) ---------------- */

  function buildIndex() {
    var entries = [];
    document.querySelectorAll("[data-index]").forEach(function (el) {
      var section = el.getAttribute("data-index-section") || "";
      var id = el.id;
      var text = (el.getAttribute("data-index-text") || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      entries.push({
        id: id,
        section: section,
        text: text,
        href: id ? ("#" + id) : null
      });
    });
    return entries;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(text, re) {
    if (!re) return escapeHtml(text);
    var out = "";
    var last = 0;
    var m;
    var guard = 0;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null && guard < 200) {
      guard++;
      if (m.index === re.lastIndex && m[0] === "") { re.lastIndex++; continue; }
      out += escapeHtml(text.slice(last, m.index));
      out += "<mark>" + escapeHtml(m[0] || "") + "</mark>";
      last = m.index + (m[0] ? m[0].length : 0);
      if (!re.global) break;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  /* ---------------- Regex builder popover ---------------- */

  var MAX_PATTERN_LENGTH = 200;
  var MAX_SAMPLE_LENGTH = 4000;

  function safeCompile(pattern, flags) {
    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error("Pattern is too long (limit " + MAX_PATTERN_LENGTH + " characters).");
    }
    // Guard against a few classic catastrophic-backtracking shapes.
    if (/(\([^)]*[+*]\)[+*])|(\([^)]*\+\)\+)/.test(pattern)) {
      throw new Error("This pattern shape can run away (nested repetition) — try a narrower group.");
    }
    return new RegExp(pattern, flags);
  }

  function initSearchAndRegexBuilder() {
    var root = document.querySelector("[data-site-search]");
    if (!root) return;

    var input = root.querySelector("[data-search-input]");
    var toggleBtn = root.querySelector("[data-regex-toggle]");
    var popover = root.querySelector("[data-regex-popover]");
    var resultsBox = root.querySelector("[data-search-results]");
    var patternInput = popover ? popover.querySelector("[data-regex-pattern]") : null;
    var flagsBoxes = popover ? popover.querySelectorAll("[data-regex-flag]") : [];
    var sampleArea = popover ? popover.querySelector("[data-regex-sample]") : null;
    var statusEl = popover ? popover.querySelector("[data-regex-status]") : null;
    var matchesEl = popover ? popover.querySelector("[data-regex-matches]") : null;
    var applyBtn = popover ? popover.querySelector("[data-regex-apply]") : null;
    var clearBtn = popover ? popover.querySelector("[data-regex-clear]") : null;

    var index = buildIndex();
    var regexMode = false;
    var activePattern = null; // RegExp | null

    function currentFlags() {
      var f = "gi";
      // Additional flag toggles (multiline, unicode) if present.
      Array.prototype.forEach.call(flagsBoxes, function (cb) {
        var f2 = cb.getAttribute("data-regex-flag");
        if (cb.checked && f2 && f.indexOf(f2) === -1) f += f2;
      });
      return f;
    }

    function renderResults(query) {
      if (!resultsBox) return;
      resultsBox.innerHTML = "";
      if (!query) {
        resultsBox.hidden = true;
        return;
      }

      var matcher = null;
      var err = null;
      if (regexMode && activePattern) {
        matcher = activePattern;
      } else if (query) {
        var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try { matcher = new RegExp(escaped, "gi"); } catch (e) { err = e; }
      }

      var matched = [];
      if (matcher) {
        index.forEach(function (entry) {
          matcher.lastIndex = 0;
          if (matcher.test(entry.text)) {
            matched.push(entry);
          }
        });
      }

      resultsBox.hidden = false;
      if (err) {
        var e1 = document.createElement("div");
        e1.className = "search-empty";
        e1.textContent = "That pattern isn't valid yet.";
        resultsBox.appendChild(e1);
        return;
      }
      if (!matched.length) {
        var e2 = document.createElement("div");
        e2.className = "search-empty";
        e2.textContent = "No matches on this page.";
        resultsBox.appendChild(e2);
        return;
      }

      matched.slice(0, 24).forEach(function (entry) {
        var a = document.createElement("a");
        if (entry.href) a.href = entry.href;
        else a.href = "#";
        var sectionLabel = document.createElement("div");
        sectionLabel.className = "result-section";
        sectionLabel.textContent = entry.section || "On this page";
        var snippet = document.createElement("div");
        matcher.lastIndex = 0;
        var re2 = new RegExp(matcher.source, matcher.flags.indexOf("g") === -1 ? matcher.flags + "g" : matcher.flags);
        snippet.innerHTML = highlight(entry.text.slice(0, 160), re2);
        a.appendChild(sectionLabel);
        a.appendChild(snippet);
        a.addEventListener("click", function () {
          resultsBox.hidden = true;
        });
        resultsBox.appendChild(a);
      });
    }

    if (input) {
      input.addEventListener("input", function () {
        renderResults(input.value.trim());
      });
      input.addEventListener("focus", function () {
        if (input.value.trim()) renderResults(input.value.trim());
      });
      document.addEventListener("click", function (ev) {
        if (!root.contains(ev.target)) {
          if (resultsBox) resultsBox.hidden = true;
        }
      });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") {
          if (resultsBox) resultsBox.hidden = true;
        }
      });
    }

    if (!popover || !toggleBtn) return;

    function openPopover() {
      popover.hidden = false;
      toggleBtn.setAttribute("aria-expanded", "true");
      if (patternInput) patternInput.focus();
    }
    function closePopover(returnFocus) {
      popover.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) toggleBtn.focus();
    }

    toggleBtn.addEventListener("click", function () {
      if (popover.hidden) openPopover(); else closePopover(true);
    });

    popover.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        closePopover(true);
      }
    });

    document.addEventListener("click", function (ev) {
      if (!popover.hidden && !popover.contains(ev.target) && ev.target !== toggleBtn && !toggleBtn.contains(ev.target)) {
        closePopover(false);
      }
    });

    function evaluate() {
      var pattern = patternInput ? patternInput.value : "";
      var sample = sampleArea ? sampleArea.value.slice(0, MAX_SAMPLE_LENGTH) : "";
      if (!pattern) {
        if (statusEl) { statusEl.textContent = "Enter a pattern to preview matches."; statusEl.classList.remove("err"); }
        if (matchesEl) matchesEl.innerHTML = "";
        return null;
      }
      try {
        var re = safeCompile(pattern, currentFlags());
        var count = 0;
        var re2 = new RegExp(re.source, re.flags.indexOf("g") === -1 ? re.flags + "g" : re.flags);
        var m;
        var guard = 0;
        while ((m = re2.exec(sample)) !== null && guard < 500) {
          guard++;
          count++;
          if (m[0] === "") re2.lastIndex++;
        }
        if (statusEl) {
          statusEl.textContent = count + " match" + (count === 1 ? "" : "es") + " against the sample text below.";
          statusEl.classList.remove("err");
        }
        if (matchesEl) {
          matchesEl.innerHTML = highlight(sample || "(no sample text yet — type below)", re2) || "";
        }
        return re;
      } catch (e) {
        if (statusEl) { statusEl.textContent = e.message || "That pattern isn't valid."; statusEl.classList.add("err"); }
        if (matchesEl) matchesEl.innerHTML = "";
        return null;
      }
    }

    if (patternInput) patternInput.addEventListener("input", evaluate);
    if (sampleArea) sampleArea.addEventListener("input", evaluate);
    Array.prototype.forEach.call(flagsBoxes, function (cb) { cb.addEventListener("change", evaluate); });

    var insertButtons = popover.querySelectorAll("[data-regex-insert]");
    insertButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!patternInput) return;
        var token = btn.getAttribute("data-regex-insert");
        var start = patternInput.selectionStart || patternInput.value.length;
        var end = patternInput.selectionEnd || patternInput.value.length;
        patternInput.value = patternInput.value.slice(0, start) + token + patternInput.value.slice(end);
        patternInput.focus();
        patternInput.selectionStart = patternInput.selectionEnd = start + token.length;
        evaluate();
      });
    });

    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        var re = evaluate();
        if (!re) {
          toast("Fix the pattern before applying it.");
          return;
        }
        activePattern = re;
        regexMode = true;
        if (toggleBtn) toggleBtn.setAttribute("aria-pressed", "true");
        closePopover(true);
        toast("Regex search applied to the page search.");
        if (input) renderResults(input.value.trim());
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        activePattern = null;
        regexMode = false;
        if (toggleBtn) toggleBtn.setAttribute("aria-pressed", "false");
        if (patternInput) patternInput.value = "";
        if (statusEl) { statusEl.textContent = "Enter a pattern to preview matches."; statusEl.classList.remove("err"); }
        if (matchesEl) matchesEl.innerHTML = "";
        toast("Regex search cleared — plain text search resumed.");
        if (input) renderResults(input.value.trim());
      });
    }
  }

  /* ---------------- Mobile header: hamburger menu ---------------- */

  function initMobileMenu() {
    var toggle = document.querySelector("[data-mobile-menu-toggle]");
    var panel = document.querySelector("[data-mobile-nav-panel]");
    if (!toggle || !panel) return;

    function open() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }
    function close(returnFocus) {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", function () {
      if (panel.hidden) open(); else close(false);
    });
    panel.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); close(true); }
    });
    panel.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { close(false); });
    });
    document.addEventListener("click", function (ev) {
      if (!panel.hidden && !panel.contains(ev.target) && ev.target !== toggle && !toggle.contains(ev.target)) {
        close(false);
      }
    });
    // A narrow-to-wide resize (rotating a tablet, or a real desktop resize)
    // should not leave the panel awkwardly open behind now-visible inline nav.
    window.addEventListener("resize", function () {
      if (window.innerWidth > 760 && !panel.hidden) close(false);
    });
  }

  /* ---------------- Mobile header: search overlay ---------------- */

  function initMobileSearch() {
    var toggle = document.querySelector("[data-mobile-search-toggle]");
    var wrap = document.querySelector("[data-site-search]");
    var closeBtn = document.querySelector("[data-mobile-search-close]");
    var input = document.querySelector("[data-search-input]");
    if (!toggle || !wrap) return;

    function open() {
      wrap.classList.add("mobile-open");
      toggle.setAttribute("aria-expanded", "true");
      if (input) input.focus();
    }
    function close(returnFocus) {
      wrap.classList.remove("mobile-open");
      toggle.setAttribute("aria-expanded", "false");
      var results = wrap.querySelector("[data-search-results]");
      if (results) results.hidden = true;
      var popover = wrap.querySelector("[data-regex-popover]");
      if (popover) popover.hidden = true;
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", function () {
      if (wrap.classList.contains("mobile-open")) close(false); else open();
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", function () { close(true); });
    }
    wrap.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && wrap.classList.contains("mobile-open")) {
        ev.stopPropagation();
        close(true);
      }
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 760 && wrap.classList.contains("mobile-open")) close(false);
    });
  }

  /* ---------------- Boot ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initTabs();
    initPlanner();
    initSearchAndRegexBuilder();
    initMobileMenu();
    initMobileSearch();
  });
})();
