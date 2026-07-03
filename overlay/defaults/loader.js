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
    setupChatImageProgressHints();
    refreshOverlayState();
  }

  function setupChatImageProgressHints() {
    let hintHostEl = null;
    let hintTextEl = null;
    let hintTimer = null;
    let autoHideTimer = null;
    let knownImageSrcAtStart = new Set();
    let baselineFreezeAt = 0;
    let currentRunConfig = null;

    const defaultHintConfig = {
      enabled: true,
      firstMessage: "Afbeelding wordt gegenereerd. Dit duurt meestal 10–40 seconden.",
      secondMessage: "Nog bezig met genereren. De afbeelding verschijnt hier zodra deze klaar is.",
      secondDelayMs: 40000,
    };

    function resolveHintConfig() {
      const raw = appsData?.chat_image_status && typeof appsData.chat_image_status === "object"
        ? appsData.chat_image_status
        : {};

      const enabled =
        typeof raw.enabled === "boolean"
          ? raw.enabled
          : defaultHintConfig.enabled;

      const firstMessage = String(raw.first_message || defaultHintConfig.firstMessage).trim() || defaultHintConfig.firstMessage;
      const secondMessage = String(raw.second_message || defaultHintConfig.secondMessage).trim() || defaultHintConfig.secondMessage;

      let secondDelayMs = Number(raw.second_delay_ms);
      if (!Number.isFinite(secondDelayMs)) secondDelayMs = defaultHintConfig.secondDelayMs;
      secondDelayMs = Math.max(5000, Math.min(300000, Math.round(secondDelayMs)));

      return {
        enabled,
        firstMessage,
        secondMessage,
        secondDelayMs,
      };
    }

    const FEED_SELECTORS = [
      'main [data-testid="conversation-list"]',
      'main [data-testid="chat-messages"]',
      "main ol",
      "main .messages",
      "main article",
      "main",
    ];

    function findFeedHost() {
      for (const selector of FEED_SELECTORS) {
        const el = document.querySelector(selector);
        if (el) return el;
      }
      return null;
    }

    function findAssistantOutputAnchor(feed) {
      if (!feed) return null;

      const assistantSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-author="assistant"]',
        '[data-role="assistant"]',
        '[data-testid*="assistant" i]',
      ];

      for (const selector of assistantSelectors) {
        const nodes = Array.from(feed.querySelectorAll(selector));
        if (nodes.length) return nodes[nodes.length - 1];
      }

      const genericMessageSelectors = [
        '[data-testid*="message" i]',
        '[class*="message" i]',
        'article',
        'li',
      ];

      for (const selector of genericMessageSelectors) {
        const nodes = Array.from(feed.querySelectorAll(selector)).filter((n) => n !== hintHostEl);
        if (nodes.length) return nodes[nodes.length - 1];
      }

      return null;
    }

    function mountHintNearAssistantOutput(feed) {
      const anchor = findAssistantOutputAnchor(feed);
      if (!anchor || !anchor.parentNode) {
        feed.appendChild(hintHostEl);
        return;
      }

      const parent = anchor.parentNode;
      const next = anchor.nextSibling;

      if (hintHostEl.parentNode !== parent || hintHostEl.previousSibling !== anchor) {
        parent.insertBefore(hintHostEl, next || null);
      }
    }

    function ensureHintInFeed() {
      const feed = findFeedHost();
      if (!feed) return false;

      if (!hintHostEl) {
        hintHostEl = document.createElement("div");
        hintHostEl.id = "gc-chat-image-inline-hint";
        hintHostEl.innerHTML = `
          <div class="gc-chat-image-inline-card" role="status" aria-live="polite">
            <span class="gc-spinner gc-spinner-sm" aria-hidden="true"></span>
            <span class="gc-chat-image-inline-text"></span>
          </div>`;
        hintTextEl = hintHostEl.querySelector(".gc-chat-image-inline-text");
      }

      mountHintNearAssistantOutput(feed);

      try {
        hintHostEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        // no-op
      }

      return true;
    }

    function removeLegacyBottomHint() {
      const legacy = document.getElementById("gc-chat-image-hint");
      if (legacy) legacy.remove();
    }

    function removeHint() {
      if (hintTimer) {
        clearInterval(hintTimer);
        hintTimer = null;
      }
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
      if (hintHostEl) {
        hintHostEl.remove();
      }
      hintHostEl = null;
      hintTextEl = null;
      knownImageSrcAtStart = new Set();
      baselineFreezeAt = 0;
      currentRunConfig = null;
    }

    function setHintText(text) {
      if (!hintTextEl) return;
      hintTextEl.textContent = text || "";
    }

    function refreshHintMount() {
      if (!hintHostEl) return;
      ensureHintInFeed();
    }

    function collectGeneratedImageSrcs() {
      const imgs = Array.from(document.querySelectorAll("main img"));
      return imgs
        .map((img) => String(img.getAttribute("src") || "").trim())
        .filter((src) => src && (src.includes("/images/") || src.startsWith("data:image/")));
    }

    function detectImageRendered() {
      if (!hintHostEl) return false;
      const current = collectGeneratedImageSrcs();
      if (!current.length) return false;

      // Warm-up window: absorbeer laat gerenderde "oude" afbeeldingen
      // direct na start van een nieuwe aanvraag, zodat we geen valse
      // "Afbeelding gereed" krijgen.
      if (Date.now() < baselineFreezeAt) {
        current.forEach((src) => knownImageSrcAtStart.add(src));
        return false;
      }

      return current.some((src) => !knownImageSrcAtStart.has(src));
    }

    function detectAssistantErrorNearEnd() {
      if (!hintHostEl) return false;
      const candidates = Array.from(
        document.querySelectorAll("main [role='alert'], main .error, main [data-testid*='error']")
      ).slice(-3);
      return candidates.some((el) => {
        const text = String(el.textContent || "").toLowerCase();
        return text.includes("fout") || text.includes("error") || text.includes("mislukt");
      });
    }

    function isImageIntent(text) {
      const t = String(text || "").toLowerCase();
      return /(afbeeld|plaatje|illustratie|teken|visualiseer|genereer.*afbeeld|image|illustration)/i.test(t);
    }

    function extractTextFromPayload(payload) {
      if (!payload || typeof payload !== "object") return "";

      const direct = [
        payload.text,
        payload.prompt,
        payload.input,
        payload.message,
        payload.query,
        payload.user_input,
      ]
        .map((v) => String(v || "").trim())
        .find(Boolean);
      if (direct) return direct;

      const messages = Array.isArray(payload.messages)
        ? payload.messages
        : Array.isArray(payload.body?.messages)
        ? payload.body.messages
        : [];

      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] || {};
        if (String(m.role || "").toLowerCase() !== "user") continue;

        if (typeof m.content === "string" && m.content.trim()) {
          return m.content.trim();
        }

        if (Array.isArray(m.content)) {
          const joined = m.content
            .map((part) => {
              if (!part) return "";
              if (typeof part === "string") return part;
              return String(part.text || part.content || "");
            })
            .join(" ")
            .trim();
          if (joined) return joined;
        }
      }

      return "";
    }

    function showHint() {
      if (!overlayActive) return;
      currentRunConfig = resolveHintConfig();
      if (!currentRunConfig.enabled) return;

      removeLegacyBottomHint();
      if (!ensureHintInFeed()) return;

      // Baseline voor deze run: alleen nieuwe afbeeldingen na deze start tellen.
      knownImageSrcAtStart = new Set(collectGeneratedImageSrcs());
      baselineFreezeAt = Date.now() + 2500;

      // Herstel loading-state als vorige run de kaart al op "done" heeft gezet.
      const card = hintHostEl?.querySelector(".gc-chat-image-inline-card");
      if (card) card.classList.remove("gc-chat-image-inline-card-done");
      const existingSpinner = hintHostEl?.querySelector(".gc-spinner");
      if (!existingSpinner && hintHostEl) {
        const spinner = document.createElement("span");
        spinner.className = "gc-spinner gc-spinner-sm";
        spinner.setAttribute("aria-hidden", "true");
        const textNode = hintHostEl.querySelector(".gc-chat-image-inline-text");
        if (textNode) textNode.insertAdjacentElement("beforebegin", spinner);
      }

      setHintText(currentRunConfig.firstMessage);

      let idx = 0;
      if (hintTimer) clearInterval(hintTimer);
      hintTimer = setInterval(() => {
        if (!hintHostEl) return;
        refreshHintMount();
        idx = Math.min(idx + 1, 1);
        setHintText(idx === 0 ? currentRunConfig.firstMessage : currentRunConfig.secondMessage);
      }, currentRunConfig.secondDelayMs);

      if (autoHideTimer) clearTimeout(autoHideTimer);
      autoHideTimer = setTimeout(removeHint, 5 * 60 * 1000);
    }

    function lastComposerText() {
      const candidates = [
        document.querySelector('textarea[data-testid="text-input"]'),
        document.querySelector('textarea[placeholder*="bericht" i]'),
        document.querySelector('textarea[placeholder*="message" i]'),
        document.querySelector("footer textarea"),
        document.querySelector("textarea"),
      ].filter(Boolean);

      for (const el of candidates) {
        const value = String(el.value || "").trim();
        if (value) return value;
      }
      return "";
    }

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      try {
        let url = "";
        if (typeof input === "string") {
          url = input;
        } else if (input && typeof input.url === "string") {
          url = input.url;
        }

        const normalizedUrl = String(url || "").toLowerCase();
        const isLikelyChatSend =
          normalizedUrl.includes("/api/ask") ||
          normalizedUrl.includes("/api/messages") ||
          normalizedUrl.includes("/api/chat") ||
          normalizedUrl.includes("/v1/chat/completions");

        if (isLikelyChatSend) {
          let bodyText = "";

          if (init && typeof init.body === "string") {
            bodyText = init.body;
          } else if (input instanceof Request) {
            try {
              bodyText = await input.clone().text();
            } catch {
              bodyText = "";
            }
          }

          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              const userText = extractTextFromPayload(parsed);
              if (isImageIntent(userText)) {
                showHint();
              }
            } catch {
              if (isImageIntent(bodyText)) {
                showHint();
              }
            }
          }
        }
      } catch {
        // no-op
      }

      return nativeFetch(input, init);
    };

    document.addEventListener(
      "click",
      (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const submitLike = target.closest('button[type="submit"], button[aria-label*="send" i], button[aria-label*="verzend" i]');
        if (!submitLike) return;

        const text = lastComposerText();
        if (isImageIntent(text)) {
          showHint();
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        const target = e.target;
        if (!(target instanceof HTMLTextAreaElement)) return;

        const text = String(target.value || "").trim();
        if (isImageIntent(text)) {
          showHint();
        }
      },
      true
    );

    const observer = new MutationObserver(() => {
      removeLegacyBottomHint();
      if (detectImageRendered()) {
        removeHint();
      } else if (detectAssistantErrorNearEnd()) {
        removeHint();
      }

      refreshHintMount();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    removeLegacyBottomHint();
    window.addEventListener("beforeunload", removeHint);
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
        } else if (target === "imagegen") {
          openImageGenerator(app);
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

  function openAppOverviewFromMiniApp(container) {
    if (container) container.remove();
    setTimeout(() => {
      if (overlayActive) openAppLauncher();
    }, 40);
  }

  function openIframe(url, title) {
    if (document.getElementById("gc-iframe")) return;
    const container = document.createElement("div");
    container.id = "gc-iframe";
    container.innerHTML = `
      <div class="gc-iframe-head">
        <div class="gc-mini-head-left">
          <button id="gc-iframe-back" class="gc-mini-nav-btn" type="button">← Overzicht</button>
          <strong>${escapeHTML(title)}</strong>
        </div>
        <button id="gc-iframe-close">✕</button>
      </div>
      <iframe src="${escapeAttr(url)}" title="${escapeAttr(title)}"></iframe>`;
    document.body.appendChild(container);
    document.getElementById("gc-iframe-back")?.addEventListener("click", () => openAppOverviewFromMiniApp(container));
    document.getElementById("gc-iframe-close")?.addEventListener("click", () => container.remove());
  }

  function openVersimpelaar(app) {
    if (document.getElementById("gc-vs")) return;
    const webhook = app.url || "";
    const defaultLevel = app.config?.default_level || "B1";
    const webhookToken = String(app.config?.webhook_token || "").trim();
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
        <div class="gc-mini-head-left">
          <button id="gc-vs-back" class="gc-mini-nav-btn" type="button">← Overzicht</button>
          <strong>Versimpelaar</strong>
        </div>
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
    const backBtn = document.getElementById("gc-vs-back");
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
    backBtn?.addEventListener("click", () => openAppOverviewFromMiniApp(container));

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
          headers: {
            "Content-Type": "application/json",
            ...(webhookToken ? { "x-govchat-token": webhookToken } : {}),
          },
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

  function openImageGenerator(app) {
    if (document.getElementById("gc-img")) return;

    const apiBase = String(app.config?.image_jobs_api || app.url || "").trim();
    const apiToken = String(app.config?.image_jobs_token || "").trim();

    const container = document.createElement("div");
    container.id = "gc-img";
    container.innerHTML = `
      <div class="gc-img-head">
        <div class="gc-mini-head-left">
          <button id="gc-img-back" class="gc-mini-nav-btn" type="button">← Overzicht</button>
          <strong>Afbeelding generator</strong>
        </div>
        <button id="gc-img-close">✕</button>
      </div>
      <div class="gc-img-intro">
        Start een generatie-opdracht. Je ziet live statusupdates tijdens het genereren.
      </div>
      <div class="gc-img-form-row">
        <label for="gc-img-prompt">Prompt</label>
        <textarea id="gc-img-prompt" placeholder="Beschrijf de gewenste afbeelding zo concreet mogelijk."></textarea>
      </div>
      <div class="gc-img-grid">
        <label for="gc-img-size">Formaat
          <select id="gc-img-size">
            <option value="1024x1024" selected>1024x1024</option>
            <option value="1536x1024">1536x1024</option>
            <option value="1024x1536">1024x1536</option>
          </select>
        </label>
        <label for="gc-img-quality">Kwaliteit
          <select id="gc-img-quality">
            <option value="standard" selected>standard</option>
            <option value="hd">hd</option>
          </select>
        </label>
      </div>
      <div class="gc-img-actions">
        <button id="gc-img-run" type="button">Genereer afbeelding</button>
      </div>
      <div id="gc-img-status" class="gc-img-status" data-kind="idle">
        <span class="gc-spinner" aria-hidden="true" style="display:none"></span>
        <span class="gc-img-status-text">Klaar om een afbeelding te starten.</span>
      </div>
      <div id="gc-img-result" class="gc-img-result" hidden>
        <div class="gc-img-preview-wrap">
          <img id="gc-img-preview" alt="Gegenereerde afbeelding" />
        </div>
        <div class="gc-img-links">
          <a id="gc-img-open" href="#" target="_blank" rel="noopener noreferrer">Open afbeelding in nieuw tabblad</a>
          <button id="gc-img-copy-md" type="button">Kopieer markdown</button>
        </div>
      </div>`;

    document.body.appendChild(container);

    const closeBtn = document.getElementById("gc-img-close");
    const backBtn = document.getElementById("gc-img-back");
    const promptEl = document.getElementById("gc-img-prompt");
    const sizeEl = document.getElementById("gc-img-size");
    const qualityEl = document.getElementById("gc-img-quality");
    const runBtn = document.getElementById("gc-img-run");
    const statusEl = document.getElementById("gc-img-status");
    const resultEl = document.getElementById("gc-img-result");
    const previewEl = document.getElementById("gc-img-preview");
    const openEl = document.getElementById("gc-img-open");
    const copyMdBtn = document.getElementById("gc-img-copy-md");

    let pollingTimer = null;
    let lastMarkdown = "";

    function clearPolling() {
      if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
      }
    }

    function closeModal() {
      clearPolling();
      container.remove();
    }

    function setStatus(text, kind = "info") {
      if (!statusEl) return;
      statusEl.dataset.kind = kind;
      const textEl = statusEl.querySelector(".gc-img-status-text");
      if (textEl) textEl.textContent = text || "";
      const spinner = statusEl.querySelector(".gc-spinner");
      if (spinner) {
        spinner.style.display = kind === "success" || kind === "error" ? "none" : "inline-block";
      }
    }

    function getAuthHeaders() {
      if (!apiToken) return { "Content-Type": "application/json" };
      return {
        "Content-Type": "application/json",
        "x-govchat-token": apiToken,
      };
    }

    function isTerminalStatus(s) {
      return s === "succeeded" || s === "failed";
    }

    function renderJobResult(job) {
      const imageUrl = String(job?.image_url || "").trim();
      const markdown = String(job?.markdown || "").trim() || (imageUrl ? `![gegenereerde afbeelding](${imageUrl})` : "");
      lastMarkdown = markdown;

      if (!imageUrl) {
        if (resultEl) resultEl.hidden = true;
        return;
      }

      if (previewEl) previewEl.src = imageUrl;
      if (openEl) openEl.href = imageUrl;
      if (resultEl) resultEl.hidden = false;
    }

    async function pollJob(jobId, delayMs) {
      clearPolling();
      pollingTimer = setTimeout(async () => {
        try {
          const resp = await fetch(`${apiBase}/${encodeURIComponent(jobId)}`, {
            method: "GET",
            headers: apiToken ? { "x-govchat-token": apiToken } : {},
            cache: "no-store",
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const job = await resp.json();
          const status = String(job.status || "").trim();
          const message = String(job.message || "").trim();
          const errorMessage = String(job.error || "").trim();

          if (status === "failed") {
            setStatus(errorMessage || message || "Afbeelding genereren is mislukt.", "error");
            runBtn.disabled = false;
            clearPolling();
            return;
          }

          if (status === "succeeded") {
            setStatus(message || "Je afbeelding is klaar.", "success");
            renderJobResult(job);
            runBtn.disabled = false;
            clearPolling();
            return;
          }

          setStatus(message || "Afbeelding wordt verwerkt...", "info");
          const nextDelay = Number(job.poll_after_ms) > 0 ? Number(job.poll_after_ms) : 1200;
          if (!isTerminalStatus(status)) {
            pollJob(jobId, nextDelay);
          }
        } catch (err) {
          setStatus(`Status ophalen mislukt: ${err.message}`, "error");
          runBtn.disabled = false;
          clearPolling();
        }
      }, Math.max(350, Number(delayMs) || 1200));
    }

    closeBtn?.addEventListener("click", closeModal);
    backBtn?.addEventListener("click", () => openAppOverviewFromMiniApp(container));

    copyMdBtn?.addEventListener("click", async () => {
      if (!lastMarkdown) {
        setStatus("Er is nog geen markdown om te kopiëren.", "info");
        return;
      }
      try {
        await navigator.clipboard.writeText(lastMarkdown);
        setStatus("Markdown gekopieerd.", "success");
      } catch {
        setStatus("Kopiëren mislukt in deze browser.", "error");
      }
    });

    runBtn?.addEventListener("click", async () => {
      const prompt = String(promptEl?.value || "").trim();
      if (!prompt) {
        setStatus("Voer eerst een prompt in.", "error");
        return;
      }

      if (!apiBase) {
        setStatus("Image-jobs API ontbreekt. Stel deze in bij de app-configuratie.", "error");
        return;
      }

      runBtn.disabled = true;
      if (resultEl) resultEl.hidden = true;
      setStatus("Aanvraag wordt gestart...", "info");

      try {
        const resp = await fetch(apiBase, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            prompt,
            size: String(sizeEl?.value || "1024x1024"),
            quality: String(qualityEl?.value || "standard"),
          }),
        });

        const rawBody = await resp.text();
        let body;
        try {
          body = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          body = { error: rawBody };
        }
        if (!resp.ok) {
          const msg = String(body?.error || body?.message || `HTTP ${resp.status}`).trim();
          throw new Error(msg || `HTTP ${resp.status}`);
        }

        const jobId = String(body.job_id || "").trim();
        if (!jobId) throw new Error("Geen job-id ontvangen.");

        const firstMessage = String(body.message || "").trim() || "Je afbeelding staat in de wachtrij.";
        setStatus(firstMessage, "info");

        const firstDelay = Number(body.poll_after_ms) > 0 ? Number(body.poll_after_ms) : 1200;
        pollJob(jobId, firstDelay);
      } catch (err) {
        setStatus(`Starten mislukt: ${err.message}`, "error");
        runBtn.disabled = false;
      }
    });
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

