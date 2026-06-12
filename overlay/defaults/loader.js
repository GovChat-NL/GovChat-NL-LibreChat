/**
 * GovChat overlay loader for LibreChat (no fork)
 * Served via /govchat-overlay/loader.js by nginx reverse proxy.
 */
(function () {
  "use strict";

  const CONFIG = {
    helpContentUrl: "/govchat-overlay/help-content.json",
    appsUrl: "/govchat-overlay/apps.json",
    appName: document.title || "LibreChat",
    storageKey: "govchat_help_dont_show",
    footerBrandText: "GovChat-NL v0.0.1",
    footerBrandUrl: "https://govchat-nl.github.io/",
    helpFaqUrl: "https://govchat-nl.github.io/",
  };

  let helpData = null;
  let appsData = null;
  let overlayActive = false;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    observeRouteChanges();
    refreshOverlayState();
  }

  function isAuthRoute(pathname) {
    const p = (pathname || "").toLowerCase();
    return (
      p.includes("/login") ||
      p.includes("/register") ||
      p.includes("/forgot") ||
      p.includes("/reset") ||
      p.includes("/verify")
    );
  }

  function isMainAppRoute(pathname) {
    const p = (pathname || "").toLowerCase();
    // LibreChat hoofdscherm (gesprekken) draait standaard onder /c/*
    return p === "/c" || p.startsWith("/c/");
  }

  function shouldActivateOverlay() {
    const path = window.location.pathname;
    if (isAuthRoute(path)) return false;
    if (!isMainAppRoute(path)) return false;
    if (isLoginScreenVisible()) return false;
    if (!hasLoggedInUIMarkers()) return false;
    return true;
  }

  function refreshOverlayState() {
    applyFooterBranding();
    rewriteHelpFaqMenuLink();

    const shouldBeActive = shouldActivateOverlay();
    if (shouldBeActive && !overlayActive) {
      overlayActive = true;
      createButtons();
      Promise.all([loadHelpContent(), loadAppsConfig()]).catch(() => {
        // no-op
      });
      return;
    }
    if (!shouldBeActive && overlayActive) {
      overlayActive = false;
      removeButtonsAndModals();
    }
  }

  function rewriteHelpFaqMenuLink() {
    const targetUrl = CONFIG.helpFaqUrl;

    const normalize = (s) =>
      (s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    // Strictly target only the "Help & FAQ" item.
    document.querySelectorAll("a, button, [role='menuitem']").forEach((el) => {
      const label = normalize(el.textContent);
      if (label !== "help & faq") return;

      if (el.tagName === "A") {
        el.setAttribute("href", targetUrl);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }

      if (el.getAttribute("data-govchat-helpfaq") === "1") return;
      el.setAttribute("data-govchat-helpfaq", "1");
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      });
    });
  }

  function applyFooterBranding() {
    if (!isMainAppRoute(window.location.pathname)) return;

    // Exact target as shared by user:
    // <div role="contentinfo"><span><a href="https://librechat.ai">LibreChat</a> ...</span></div>
    const libreChatLink = document.querySelector('div[role="contentinfo"] span > a[href*="librechat.ai"]');
    if (!libreChatLink) return;

    const span = libreChatLink.closest("span");
    if (!span) return;

    if (span.querySelector("a[data-govchat-brand='1']")) return;

    span.innerHTML = `<a data-govchat-brand="1" class="gc-footer-brand" href="${escapeAttr(
      CONFIG.footerBrandUrl
    )}" target="_blank" rel="noopener noreferrer">${escapeHTML(CONFIG.footerBrandText)}</a>`;
  }

  function isLoginScreenVisible() {
    // Hard gate: zolang een zichtbaar wachtwoordveld aanwezig is, nooit overlay tonen.
    const passwordInput = document.querySelector('input[type="password"]');
    if (passwordInput && isVisible(passwordInput)) return true;

    const emailInput = document.querySelector('input[type="email"]');
    if (emailInput && isVisible(emailInput)) {
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn && isVisible(submitBtn)) return true;
    }

    return false;
  }

  function hasLoggedInUIMarkers() {
    return Boolean(
      // Betrouwbaarste marker: user menu rechtsboven na succesvolle login.
      document.querySelector('button[aria-label="User Menu"]') ||
        document.querySelector('button[aria-haspopup="menu"] img')?.closest("button")
    );
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function observeRouteChanges() {
    const _pushState = history.pushState;
    const _replaceState = history.replaceState;

    history.pushState = function () {
      _pushState.apply(this, arguments);
      refreshOverlayState();
    };
    history.replaceState = function () {
      _replaceState.apply(this, arguments);
      refreshOverlayState();
    };

    window.addEventListener("popstate", refreshOverlayState);
    window.addEventListener("hashchange", refreshOverlayState);

    setInterval(refreshOverlayState, 1000);
  }

  function removeButtonsAndModals() {
    [
      "gc-help-btn",
      "gc-launcher-btn",
      "gc-help-backdrop",
      "gc-app-backdrop",
      "gc-iframe",
      "gc-vs",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    document.body.style.overflow = "";
  }

  function createButtons() {
    if (!document.getElementById("gc-help-btn")) {
      const helpBtn = document.createElement("button");
      helpBtn.id = "gc-help-btn";
      helpBtn.title = "Help";
      helpBtn.textContent = "?";
      helpBtn.addEventListener("click", openHelpModal);
      document.body.appendChild(helpBtn);
    }

    if (!document.getElementById("gc-launcher-btn")) {
      const launcherBtn = document.createElement("button");
      launcherBtn.id = "gc-launcher-btn";
      launcherBtn.title = "App Launcher";
      launcherBtn.innerHTML = `
        <svg class="gc-launcher-grid-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="4" height="4" rx="0.8"></rect>
          <rect x="10" y="3" width="4" height="4" rx="0.8"></rect>
          <rect x="17" y="3" width="4" height="4" rx="0.8"></rect>
          <rect x="3" y="10" width="4" height="4" rx="0.8"></rect>
          <rect x="10" y="10" width="4" height="4" rx="0.8"></rect>
          <rect x="17" y="10" width="4" height="4" rx="0.8"></rect>
          <rect x="3" y="17" width="4" height="4" rx="0.8"></rect>
          <rect x="10" y="17" width="4" height="4" rx="0.8"></rect>
          <rect x="17" y="17" width="4" height="4" rx="0.8"></rect>
        </svg>`;
      launcherBtn.addEventListener("click", openAppLauncher);
      document.body.appendChild(launcherBtn);
    }
  }

  async function loadHelpContent() {
    try {
      const resp = await fetch(CONFIG.helpContentUrl, { cache: "no-store" });
      helpData = resp.ok ? await resp.json() : getFallbackHelp();
    } catch {
      helpData = getFallbackHelp();
    }

    const dontShow = localStorage.getItem(CONFIG.storageKey) === "1";
    if (!dontShow) {
      setTimeout(() => {
        if (overlayActive) {
          openHelpModal();
        }
      }, 250);
    }
  }

  async function loadAppsConfig() {
    try {
      const resp = await fetch(CONFIG.appsUrl, { cache: "no-store" });
      appsData = resp.ok ? await resp.json() : { title: "App Launcher", enabled: false, apps: [] };
    } catch {
      appsData = { title: "App Launcher", enabled: false, apps: [] };
    }

    if (appsData.enabled === false) {
      const btn = document.getElementById("gc-launcher-btn");
      if (btn) btn.style.display = "none";
    }
  }

  function getFallbackHelp() {
    return {
      title: "Handleiding",
      subtitle: "Welkom",
      sections: [
        {
          id: "intro",
          emoji: "📘",
          title: "Welkom",
          content: "<p>Help-content kon niet geladen worden.</p>",
        },
      ],
    };
  }

  function r(text) {
    return (text || "").replace(/\{\{APP_NAME\}\}/g, CONFIG.appName);
  }

  function openHelpModal() {
    if (!helpData || document.getElementById("gc-help-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "gc-help-backdrop";
    backdrop.innerHTML = `
      <div id="gc-help-modal">
        <div class="gc-modal-head">
          <h2>${escapeHTML(r(helpData.title || "Handleiding"))}</h2>
          <button id="gc-help-close">✕</button>
        </div>
        <div class="gc-modal-sub">${escapeHTML(r(helpData.subtitle || ""))}</div>
        <div class="gc-help-content">
          ${(helpData.sections || [])
            .map(
              (s) =>
                `<section><h3>${escapeHTML(s.emoji || "")} ${escapeHTML(r(s.title || ""))}</h3>${r(s.content || "")}</section>`
            )
            .join("")}
        </div>
        <label class="gc-dont-show"><input id="gc-help-dont-show" type="checkbox"/> Niet meer automatisch tonen</label>
      </div>`;

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeHelpModal();
    });
    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    const closeBtn = document.getElementById("gc-help-close");
    if (closeBtn) closeBtn.addEventListener("click", closeHelpModal);

    const checkbox = document.getElementById("gc-help-dont-show");
    if (checkbox) {
      checkbox.checked = localStorage.getItem(CONFIG.storageKey) === "1";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) localStorage.setItem(CONFIG.storageKey, "1");
        else localStorage.removeItem(CONFIG.storageKey);
      });
    }
  }

  function closeHelpModal() {
    const el = document.getElementById("gc-help-backdrop");
    if (el) el.remove();
    document.body.style.overflow = "";
  }

  function openAppLauncher() {
    if (!appsData || !appsData.apps || document.getElementById("gc-app-backdrop")) return;

    const cards = appsData.apps
      .map(
        (app) => `
      <button class="gc-app-card" data-id="${escapeAttr(app.id)}" data-url="${escapeAttr(app.url)}" data-target="${escapeAttr(app.target || "blank")}">
        <span class="gc-app-icon">${escapeHTML(app.icon || "📦")}</span>
        <span class="gc-app-meta">
          <span class="gc-app-name">${escapeHTML(app.name || "App")}</span>
          <span class="gc-app-desc">${escapeHTML(app.description || "")}</span>
        </span>
      </button>`
      )
      .join("");

    const backdrop = document.createElement("div");
    backdrop.id = "gc-app-backdrop";
    backdrop.innerHTML = `
      <div id="gc-app-modal">
        <div class="gc-modal-head">
          <h2>${escapeHTML(appsData.title || "App Launcher")}</h2>
          <button id="gc-app-close">✕</button>
        </div>
        <div class="gc-app-grid">${cards}</div>
      </div>`;

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeAppLauncher();
    });
    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    const closeBtn = document.getElementById("gc-app-close");
    if (closeBtn) closeBtn.addEventListener("click", closeAppLauncher);

    backdrop.querySelectorAll(".gc-app-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-id");
        const url = card.getAttribute("data-url");
        const target = card.getAttribute("data-target");
        const app = (appsData.apps || []).find((a) => a.id === id) || { url, target };
        closeAppLauncher();

        if (target === "versimpelaar") {
          openVersimpelaar(app);
        } else if (target === "navigate") {
          window.location.href = url;
        } else if (target === "iframe") {
          openIframe(url, app.name || "App");
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
    });
  }

  function closeAppLauncher() {
    const el = document.getElementById("gc-app-backdrop");
    if (el) el.remove();
    document.body.style.overflow = "";
  }

  function openIframe(url, title) {
    if (document.getElementById("gc-iframe")) return;
    const container = document.createElement("div");
    container.id = "gc-iframe";
    container.innerHTML = `
      <div class="gc-iframe-head">
        <strong>${escapeHTML(title)}</strong>
        <button id="gc-iframe-close">✕</button>
      </div>
      <iframe src="${escapeAttr(url)}" title="${escapeAttr(title)}"></iframe>`;
    document.body.appendChild(container);
    document.getElementById("gc-iframe-close")?.addEventListener("click", () => container.remove());
  }

  function openVersimpelaar(app) {
    if (document.getElementById("gc-vs")) return;
    const webhook = app.url || "";
    const defaultLevel = app.config?.default_level || "B1";
    const levelOptions = Array.isArray(app.config?.language_levels) && app.config.language_levels.length
      ? app.config.language_levels
      : ["B1", "B2"];

    const storedWords = (() => {
      try {
        const raw = localStorage.getItem("gc_versimpelaar_preserved_words");
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(Boolean).map((w) => String(w).trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    })();

    let preservedWords = [...new Set(storedWords)];

    const container = document.createElement("div");
    container.id = "gc-vs";
    container.innerHTML = `
      <div class="gc-vs-head">
        <strong>Versimpelaar</strong>
        <button id="gc-vs-close">✕</button>
      </div>
      <div class="gc-vs-intro">
        Kies een tekst en breng die eenvoudig naar B1- of B2-niveau.
      </div>
      <div class="gc-vs-controls">
        <label class="gc-vs-level-wrap">Taalniveau
          <select id="gc-vs-level">${levelOptions
            .map(
              (lvl) =>
                `<option value="${escapeAttr(lvl)}" ${lvl === defaultLevel ? "selected" : ""}>${escapeHTML(lvl)}</option>`
            )
            .join("")}</select>
        </label>
      </div>

      <div class="gc-vs-preserved">
        <div class="gc-vs-preserved-title">Begrippen die je wilt behouden</div>
        <div class="gc-vs-preserved-add">
          <input id="gc-vs-word" type="text" placeholder="Voeg woord of term toe" />
          <button id="gc-vs-word-add" type="button">Toevoegen</button>
        </div>
        <div id="gc-vs-words" class="gc-vs-words"></div>
      </div>

      <div class="gc-vs-grid">
        <div>
          <label for="gc-vs-in">Oorspronkelijke tekst</label>
          <textarea id="gc-vs-in" placeholder="Plak of typ hier de tekst die je wilt vereenvoudigen."></textarea>
          <div id="gc-vs-in-meta" class="gc-vs-meta">Woorden: 0</div>
        </div>
        <div>
          <label for="gc-vs-out">Vereenvoudigde tekst</label>
          <textarea id="gc-vs-out" placeholder="Hier zie je straks de vereenvoudigde tekst." readonly></textarea>
          <div id="gc-vs-out-meta" class="gc-vs-meta">Woorden: 0</div>
        </div>
      </div>

      <div class="gc-vs-actions">
        <button id="gc-vs-run">Versimpel</button>
        <button id="gc-vs-copy" type="button">Kopieer tekst</button>
      </div>

      <div id="gc-vs-status" class="gc-vs-status"></div>`;
    document.body.appendChild(container);

    const closeBtn = document.getElementById("gc-vs-close");
    const input = document.getElementById("gc-vs-in");
    const output = document.getElementById("gc-vs-out");
    const level = document.getElementById("gc-vs-level");
    const status = document.getElementById("gc-vs-status");
    const runBtn = document.getElementById("gc-vs-run");
    const copyBtn = document.getElementById("gc-vs-copy");
    const inMeta = document.getElementById("gc-vs-in-meta");
    const outMeta = document.getElementById("gc-vs-out-meta");
    const wordInput = document.getElementById("gc-vs-word");
    const addWordBtn = document.getElementById("gc-vs-word-add");
    const wordsWrap = document.getElementById("gc-vs-words");

    function countWords(text) {
      return (text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
    }

    function renderWords() {
      if (!wordsWrap) return;
      if (!preservedWords.length) {
        wordsWrap.innerHTML = '<div class="gc-vs-empty">Geen begrippen geselecteerd.</div>';
        localStorage.setItem("gc_versimpelaar_preserved_words", JSON.stringify([]));
        return;
      }

      wordsWrap.innerHTML = preservedWords
        .map(
          (word, idx) =>
            `<button type="button" class="gc-vs-chip" data-vs-word-index="${idx}">${escapeHTML(word)} <span>✕</span></button>`
        )
        .join("");
      localStorage.setItem("gc_versimpelaar_preserved_words", JSON.stringify(preservedWords));

      wordsWrap.querySelectorAll("[data-vs-word-index]").forEach((chip) => {
        chip.addEventListener("click", () => {
          const idx = Number(chip.getAttribute("data-vs-word-index"));
          if (Number.isFinite(idx) && idx >= 0) {
            preservedWords.splice(idx, 1);
            preservedWords = [...new Set(preservedWords)];
            renderWords();
          }
        });
      });
    }

    function refreshWordCounts() {
      if (inMeta && input) inMeta.textContent = `Woorden: ${countWords(input.value)}`;
      if (outMeta && output) outMeta.textContent = `Woorden: ${countWords(output.value)}`;
    }

    closeBtn?.addEventListener("click", () => container.remove());

    input?.addEventListener("input", refreshWordCounts);

    addWordBtn?.addEventListener("click", () => {
      const value = (wordInput?.value || "").trim();
      if (!value) return;
      preservedWords = [...new Set([...preservedWords, value])];
      if (wordInput) wordInput.value = "";
      renderWords();
    });

    wordInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addWordBtn?.click();
      }
    });

    copyBtn?.addEventListener("click", async () => {
      if (!output?.value) {
        if (status) status.textContent = "Er is nog geen output om te kopiëren.";
        return;
      }
      try {
        await navigator.clipboard.writeText(output.value);
        if (status) status.textContent = "Tekst gekopieerd.";
      } catch {
        if (status) status.textContent = "Kopiëren mislukt in deze browser.";
      }
    });

    runBtn?.addEventListener("click", async () => {
      if (!input?.value?.trim()) {
        if (status) status.textContent = "Voer eerst tekst in.";
        return;
      }

      if (!webhook) {
        if (status) {
          status.textContent =
            "Webhook ontbreekt. Stel in Apps-config voor Versimpelaar een geldige URL in.";
        }
        return;
      }

      try {
        runBtn.disabled = true;
        if (status) status.textContent = "Bezig met vereenvoudigen...";

        const resp = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: input.value,
            language_level: level?.value || "B1",
            preserved_words: preservedWords,
          }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json().catch(async () => ({ text: await resp.text() }));
        const result =
          typeof data === "string"
            ? data
            : data.text || data.output || data.result || data.message || JSON.stringify(data);

        if (output) output.value = String(result || "");
        refreshWordCounts();
        if (status) status.textContent = "Klaar.";
      } catch (e) {
        if (status) status.textContent = `Fout: ${e.message}`;
      } finally {
        runBtn.disabled = false;
      }
    });

    renderWords();
    refreshWordCounts();
  }

  function escapeHTML(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();

