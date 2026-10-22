/**
 * Open WebUI Overlay - loader.js
 *
 * Drop-in help button, help modal, app launcher, and iframe viewer
 * for standard Open WebUI deployments.
 * Place this file at /app/build/static/loader.js in your Docker image.
 */
(function () {
  "use strict";

  // ── Configuration ──────────────────────────────────────────────────
  const CONFIG = {
    helpContentUrl: "/static/help-content.json",
    appsUrl: "/static/apps.json",
    appName: document.title || "Open WebUI",
    storageKey: "helpOverlay_dontShow",
    showOnFirstVisit: true,
  };

  // ── Wait for DOM ───────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    setTimeout(bootstrap, 800);
  }

  // ── State ──────────────────────────────────────────────────────────
  let helpData = null;
  let appsData = null;
  let activeSection = null;
  let openSectionId = null;
  let isFullScreen = false;

  // ── Bootstrap ──────────────────────────────────────────────────────
  function bootstrap() {
    createFloatingButton();

    loadHelpContent().then(() => {
      if (CONFIG.showOnFirstVisit) {
        const dontShow = localStorage.getItem(CONFIG.storageKey);
        if (!dontShow) {
          openHelpModal();
        }
      }
    });

    loadAppsConfig().then(() => {
      if (appsData && appsData.enabled !== false) {
        injectAppLauncherButton();
        observeSidebarChanges();
      }
    });
  }

  // =====================================================================
  //  HELP OVERLAY (existing functionality)
  // =====================================================================

  async function loadHelpContent() {
    try {
      const resp = await fetch(CONFIG.helpContentUrl);
      if (resp.ok) {
        helpData = await resp.json();
      } else {
        console.warn("[Overlay] Could not load help content:", resp.status);
        helpData = getFallbackContent();
      }
    } catch (err) {
      console.warn("[Overlay] Error loading help content:", err);
      helpData = getFallbackContent();
    }
  }

  function getFallbackContent() {
    return {
      title: "Handleiding",
      subtitle: "Welkom!",
      sections: [
        {
          id: "sec1",
          emoji: "\uD83D\uDCD6",
          title: "Welkom",
          content:
            '<h2 class="ho-chapter-title">Welkom</h2><p>Het help-bestand kon niet geladen worden.</p>',
        },
      ],
    };
  }

  function r(text) {
    return (text || "").replace(/\{\{APP_NAME\}\}/g, CONFIG.appName);
  }

  // ── Floating help button ───────────────────────────────────────────
  function createFloatingButton() {
    const btn = document.createElement("button");
    btn.id = "ho-float-btn";
    btn.setAttribute("aria-label", "Help");
    btn.title = "Help";
    btn.textContent = "?";
    btn.addEventListener("click", openHelpModal);
    document.body.appendChild(btn);
  }

  // ── Help modal ─────────────────────────────────────────────────────
  function openHelpModal() {
    if (!helpData) return;
    if (document.getElementById("ho-backdrop")) return;

    activeSection = helpData.sections[0]?.id || null;
    openSectionId = null;
    isFullScreen = false;

    const backdrop = document.createElement("div");
    backdrop.id = "ho-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeHelpModal();
    });

    const modal = document.createElement("div");
    modal.id = "ho-modal";
    modal.classList.add("ho-modal-lg");
    modal.innerHTML = buildHelpModalHTML();
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    wireHelpModalEvents(modal);
    document.body.style.overflow = "hidden";
  }

  function closeHelpModal() {
    const backdrop = document.getElementById("ho-backdrop");
    if (backdrop) {
      backdrop.remove();
      document.body.style.overflow = "";
    }
  }

  function buildHelpModalHTML() {
    const sections = helpData.sections;

    let sidebarItems = "";
    for (const sec of sections) {
      const isActive = activeSection === sec.id;
      const hasItems = sec.items && sec.items.length > 0;
      const isOpen = openSectionId === sec.id;

      sidebarItems += `
        <li class="ho-nav-item">
          <a href="#" data-section="${sec.id}" class="ho-nav-link ${isActive ? "ho-active" : ""}">
            <span>${sec.emoji || ""}</span>
            <span>${r(sec.title)}</span>
            ${
              hasItems
                ? `<span class="ho-nav-chevron ${isOpen ? "ho-open" : ""}" data-toggle="${sec.id}">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M7 7l3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>`
                : ""
            }
          </a>
          ${
            hasItems && isOpen
              ? `<ul class="ho-subnav">${sec.items
                  .map(
                    (item) => `
                  <li><a href="#" data-section="${sec.id}" data-item="${item.id}" class="ho-nav-link ho-sub">
                    <span>${item.emoji || ""}</span>
                    <span>${r(item.title)}</span>
                  </a></li>`
                  )
                  .join("")}</ul>`
              : ""
          }
        </li>`;
    }

    let contentHTML = "";
    for (const sec of sections) {
      if (sec.id === activeSection) {
        contentHTML += `<section id="ho-${sec.id}" class="ho-section">${r(sec.content)}</section>`;
        if (sec.items) {
          for (const item of sec.items) {
            contentHTML += `
              <section id="ho-${item.id}" class="ho-section">
                <h3 class="ho-section-title">${item.emoji || ""} ${r(item.title)}</h3>
                ${r(item.content)}
              </section>`;
          }
        }
      }
    }

    const dontShow = localStorage.getItem(CONFIG.storageKey) === "1";

    return `
      <div class="ho-header">
        <div class="ho-title">
          <svg class="ho-info-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          ${r(helpData.title)}
        </div>
        <div class="ho-header-actions">
          <button id="ho-btn-print" title="Print handleiding" aria-label="Print handleiding">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-8 0h8M6 18v2h12v-2"/>
            </svg>
          </button>
          <button id="ho-btn-fullscreen" title="Volledig scherm" aria-label="Volledig scherm">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 7V3.75h3.25M16.25 7V3.75h-3.25M3.75 13V16.25h3.25M16.25 13V16.25h-3.25"/>
            </svg>
          </button>
          <button id="ho-btn-close" title="Sluiten" aria-label="Sluiten">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="ho-subtitle">${r(helpData.subtitle)}</div>
      <div class="ho-body">
        <nav class="ho-sidebar" aria-label="Help navigatie">
          <ul>${sidebarItems}</ul>
        </nav>
        <div class="ho-content" id="ho-content-area">
          ${contentHTML}
        </div>
      </div>
      <div class="ho-footer">
        <label class="ho-checkbox-label">
          <input type="checkbox" id="ho-dont-show" ${dontShow ? "checked" : ""} />
          <span>Niet meer automatisch tonen</span>
        </label>
        <button id="ho-btn-close-footer" class="ho-btn-primary">Sluiten</button>
      </div>`;
  }

  function wireHelpModalEvents(modal) {
    modal.querySelector("#ho-btn-close").addEventListener("click", closeHelpModal);
    modal.querySelector("#ho-btn-close-footer").addEventListener("click", () => {
      const cb = modal.querySelector("#ho-dont-show");
      if (cb && cb.checked) {
        localStorage.setItem(CONFIG.storageKey, "1");
      }
      closeHelpModal();
    });

    modal.querySelector("#ho-btn-fullscreen").addEventListener("click", () => {
      isFullScreen = !isFullScreen;
      modal.classList.toggle("ho-modal-full", isFullScreen);
      modal.classList.toggle("ho-modal-lg", !isFullScreen);
    });

    modal.querySelector("#ho-btn-print").addEventListener("click", () => {
      printHelp();
    });

    modal.querySelectorAll("a[data-section]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const sectionId = link.dataset.section;
        const itemId = link.dataset.item;
        if (sectionId !== activeSection || itemId) {
          activeSection = sectionId;
          openSectionId = sectionId;
          rerenderHelpModal();
          if (itemId) {
            setTimeout(() => {
              const el = document.getElementById("ho-" + itemId);
              const container = document.getElementById("ho-content-area");
              if (el && container) {
                const containerTop = container.getBoundingClientRect().top;
                const elTop = el.getBoundingClientRect().top;
                container.scrollBy({ top: elTop - containerTop, behavior: "smooth" });
              }
            }, 50);
          }
        }
      });
    });

    modal.querySelectorAll(".ho-nav-chevron").forEach((chevron) => {
      chevron.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const toggleId = chevron.dataset.toggle;
        openSectionId = openSectionId === toggleId ? null : toggleId;
        rerenderHelpModal();
      });
    });

    const cb = modal.querySelector("#ho-dont-show");
    if (cb) {
      cb.addEventListener("change", () => {
        if (cb.checked) {
          localStorage.setItem(CONFIG.storageKey, "1");
        } else {
          localStorage.removeItem(CONFIG.storageKey);
        }
      });
    }

    const escHandler = (e) => {
      if (e.key === "Escape") {
        closeHelpModal();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  function rerenderHelpModal() {
    const modal = document.getElementById("ho-modal");
    if (!modal) return;
    const wasFull = isFullScreen;
    modal.innerHTML = buildHelpModalHTML();
    modal.classList.toggle("ho-modal-full", wasFull);
    modal.classList.toggle("ho-modal-lg", !wasFull);
    wireHelpModalEvents(modal);
  }

  function printHelp() {
    if (!helpData) return;
    let html = "";
    for (const sec of helpData.sections) {
      html += r(sec.content);
      if (sec.items) {
        for (const item of sec.items) {
          html += `<h3>${item.emoji || ""} ${r(item.title)}</h3>`;
          html += r(item.content);
        }
      }
    }
    const win = window.open();
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html><head><title>${r(helpData.title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; }
h1 { border-bottom: 2px solid #2563eb; padding-bottom: .5rem; }
h2 { margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; }
h3 { margin-top: 1.5rem; }
ul, ol { padding-left: 1.5rem; }
li { margin-bottom: .3rem; }
</style></head><body>
<h1>${r(helpData.title)}</h1>
${html}
</body></html>`);
    win.document.close();
    win.print();
  }

  // =====================================================================
  //  APP LAUNCHER
  // =====================================================================

  async function loadAppsConfig() {
    try {
      const resp = await fetch(CONFIG.appsUrl);
      if (resp.ok) {
        appsData = await resp.json();
      } else {
        console.warn("[Overlay] Could not load apps config:", resp.status);
      }
    } catch (err) {
      console.warn("[Overlay] Error loading apps config:", err);
    }
  }

  // ── Navbar button injection (top-right, next to profile image) ────
  function injectAppLauncherButton() {
    tryInjectNavbarButton();
  }

  function tryInjectNavbarButton() {
    if (document.getElementById("al-navbar-btn")) return;

    // Find the user profile button/image in the top-right navbar.
    // Open WebUI uses a button with a user avatar image, or an
    // avatar placeholder with initials. We look for common patterns.
    const anchor = findNavbarAnchor();
    if (!anchor) return;

    const btn = document.createElement("button");
    btn.id = "al-navbar-btn";
    btn.title = "App Launcher";
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>`;
    btn.addEventListener("click", openAppLauncher);

    // Insert before the profile button
    anchor.parentElement.insertBefore(btn, anchor);
  }

  function findNavbarAnchor() {
    // Strategy 1: Find user menu button by aria-label
    const userMenuBtn = document.querySelector('button[aria-label="User Menu"]');
    if (userMenuBtn) return userMenuBtn;

    // Strategy 2: Find profile image in top area
    // Open WebUI puts a small avatar img inside a button at the top-right
    const topButtons = document.querySelectorAll("button");
    for (const b of topButtons) {
      const img = b.querySelector("img");
      if (!img) continue;
      const rect = b.getBoundingClientRect();
      // Must be in the top-right area of the page
      if (rect.top < 60 && rect.right > window.innerWidth - 200) {
        return b;
      }
    }

    // Strategy 3: Find by typical Open WebUI structure
    // Look for buttons with profile image or initials near the top
    const avatars = document.querySelectorAll('img[class*="rounded-full"], img[class*="avatar"]');
    for (const img of avatars) {
      const btn = img.closest("button");
      if (btn) {
        const rect = btn.getBoundingClientRect();
        if (rect.top < 60) return btn;
      }
    }

    return null;
  }

  // Re-inject when SvelteKit re-renders navbar (e.g. navigation)
  function observeSidebarChanges() {
    const observer = new MutationObserver(() => {
      if (!document.getElementById("al-navbar-btn")) {
        tryInjectNavbarButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── App launcher modal ─────────────────────────────────────────────
  function openAppLauncher() {
    if (!appsData || !appsData.apps) return;
    if (document.getElementById("al-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "al-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeAppLauncher();
    });

    const modal = document.createElement("div");
    modal.id = "al-modal";

    let cardsHTML = "";
    for (const app of appsData.apps) {
      cardsHTML += `
        <button class="al-card" data-app-id="${app.id}" data-url="${escapeAttr(app.url)}" data-target="${app.target || "blank"}" title="${escapeAttr(app.description || app.name)}">
          <div class="al-card-icon">${app.icon || "\uD83D\uDCE6"}</div>
          <div class="al-card-info">
            <div class="al-card-name">${escapeHTML(app.name)}</div>
            <div class="al-card-desc">${escapeHTML(app.description || "")}</div>
          </div>
        </button>`;
    }

    modal.innerHTML = `
      <div class="ho-header">
        <div class="ho-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          ${escapeHTML(appsData.title || "App Launcher")}
        </div>
        <div class="ho-header-actions">
          <button id="al-btn-close" title="Sluiten" aria-label="Sluiten">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="al-grid">${cardsHTML}</div>`;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Wire events
    modal.querySelector("#al-btn-close").addEventListener("click", closeAppLauncher);

    modal.querySelectorAll(".al-card").forEach((card) => {
      card.addEventListener("click", () => {
        const appId = card.dataset.appId;
        const url = card.dataset.url;
        const target = card.dataset.target;

        // Find full app config for special targets
        const appConfig = appsData.apps.find((a) => a.id === appId);

        closeAppLauncher();

        if (target === "versimpelaar") {
          openVersimpelaar(appConfig || { url: url });
        } else if (target === "iframe") {
          openIframeViewer(url, card.querySelector(".al-card-name")?.textContent || "App");
        } else if (target === "navigate") {
          window.location.href = url;
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
    });

    // Escape key
    const escHandler = (e) => {
      if (e.key === "Escape") {
        closeAppLauncher();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    document.body.style.overflow = "hidden";
  }

  function closeAppLauncher() {
    const backdrop = document.getElementById("al-backdrop");
    if (backdrop) {
      backdrop.remove();
      document.body.style.overflow = "";
    }
  }

  // ── Iframe viewer ──────────────────────────────────────────────────
  function openIframeViewer(url, title) {
    if (document.getElementById("iv-container")) return;

    const container = document.createElement("div");
    container.id = "iv-container";

    container.innerHTML = `
      <div class="iv-header">
        <div class="iv-header-left">
          <button id="iv-btn-back" title="Terug naar chat" aria-label="Terug naar chat">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <span class="iv-title">${escapeHTML(title)}</span>
        </div>
        <div class="iv-header-right">
          <button id="iv-btn-external" title="Open in nieuw tabblad" aria-label="Open in nieuw tabblad">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
          </button>
          <button id="iv-btn-close" title="Sluiten" aria-label="Sluiten">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="iv-body">
        <div class="iv-loading">Laden...</div>
        <iframe src="${escapeAttr(url)}" class="iv-iframe" title="${escapeAttr(title)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
      </div>`;

    document.body.appendChild(container);

    // Hide loading when iframe loads
    const iframe = container.querySelector(".iv-iframe");
    const loading = container.querySelector(".iv-loading");
    iframe.addEventListener("load", () => {
      loading.style.display = "none";
    });
    // Also hide loading on error (iframe blocked)
    iframe.addEventListener("error", () => {
      loading.textContent = "Kan niet laden. Probeer 'Open in nieuw tabblad'.";
    });

    // Wire events
    container.querySelector("#iv-btn-back").addEventListener("click", closeIframeViewer);
    container.querySelector("#iv-btn-close").addEventListener("click", closeIframeViewer);
    container.querySelector("#iv-btn-external").addEventListener("click", () => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

    const escHandler = (e) => {
      if (e.key === "Escape") {
        closeIframeViewer();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  function closeIframeViewer() {
    const container = document.getElementById("iv-container");
    if (container) {
      container.remove();
    }
  }

  // =====================================================================
  //  VERSIMPELAAR (B1 text simplifier via n8n webhook)
  // =====================================================================

  let vsState = {
    inputText: "",
    outputText: "",
    isProcessing: false,
    languageLevel: "B1",
    webhookUrl: "",
    wordCountIn: 0,
    wordCountOut: 0,
  };

  function openVersimpelaar(app) {
    if (document.getElementById("vs-container")) return;

    vsState = {
      inputText: "",
      outputText: "",
      isProcessing: false,
      languageLevel: app.config?.default_level || "B1",
      webhookUrl: app.url,
      wordCountIn: 0,
      wordCountOut: 0,
    };

    const levels = app.config?.language_levels || ["B1", "B2"];

    const container = document.createElement("div");
    container.id = "vs-container";

    let levelBtns = levels
      .map(
        (lvl) =>
          `<button class="vs-level-btn ${lvl === vsState.languageLevel ? "vs-level-active" : ""}" data-level="${lvl}">${lvl}</button>`
      )
      .join("");

    container.innerHTML = `
      <div class="iv-header">
        <div class="iv-header-left">
          <button id="vs-btn-back" title="Sluiten" aria-label="Sluiten">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <span class="iv-title">\uD83D\uDD24 Versimpelaar</span>
        </div>
        <div class="iv-header-right">
          <div class="vs-level-group">${levelBtns}</div>
        </div>
      </div>
      <div class="vs-body">
        <div class="vs-panel vs-panel-input">
          <div class="vs-panel-header">
            <span class="vs-panel-label">Invoer</span>
            <span class="vs-word-count" id="vs-wc-in">0 woorden</span>
          </div>
          <textarea id="vs-input" class="vs-textarea" placeholder="Plak of typ hier de tekst die je wilt vereenvoudigen..."></textarea>
          <div class="vs-panel-footer">
            <button id="vs-btn-paste" class="vs-btn-secondary" title="Plakken vanuit klembord">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
              </svg>
              Plakken
            </button>
            <button id="vs-btn-clear" class="vs-btn-secondary" title="Invoer wissen">Wissen</button>
          </div>
        </div>
        <div class="vs-action-col">
          <button id="vs-btn-simplify" class="vs-btn-primary-lg" title="Vereenvoudig de tekst">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            <span>Vereenvoudig</span>
          </button>
        </div>
        <div class="vs-panel vs-panel-output">
          <div class="vs-panel-header">
            <span class="vs-panel-label">Resultaat <span class="vs-level-badge" id="vs-result-level">${vsState.languageLevel}</span></span>
            <span class="vs-word-count" id="vs-wc-out">0 woorden</span>
          </div>
          <div id="vs-output" class="vs-textarea vs-output-area">
            <span class="vs-placeholder">Het vereenvoudigde resultaat verschijnt hier...</span>
          </div>
          <div class="vs-panel-footer">
            <button id="vs-btn-copy" class="vs-btn-secondary" title="Kopieer resultaat" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Kopieer
            </button>
          </div>
        </div>
      </div>
      <div id="vs-status" class="vs-status"></div>`;

    document.body.appendChild(container);
    wireVersimpelaarEvents(container, levels);
  }

  function wireVersimpelaarEvents(container, levels) {
    const inputEl = container.querySelector("#vs-input");
    const outputEl = container.querySelector("#vs-output");
    const wcIn = container.querySelector("#vs-wc-in");
    const wcOut = container.querySelector("#vs-wc-out");
    const statusEl = container.querySelector("#vs-status");
    const simplifyBtn = container.querySelector("#vs-btn-simplify");
    const copyBtn = container.querySelector("#vs-btn-copy");
    const resultLevel = container.querySelector("#vs-result-level");

    // Back/close
    container.querySelector("#vs-btn-back").addEventListener("click", closeVersimpelaar);

    // Language level buttons
    container.querySelectorAll(".vs-level-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        vsState.languageLevel = btn.dataset.level;
        container.querySelectorAll(".vs-level-btn").forEach((b) => b.classList.remove("vs-level-active"));
        btn.classList.add("vs-level-active");
        resultLevel.textContent = vsState.languageLevel;
      });
    });

    // Word count on input
    inputEl.addEventListener("input", () => {
      vsState.inputText = inputEl.value;
      const wc = countWords(inputEl.value);
      vsState.wordCountIn = wc;
      wcIn.textContent = wc + " woorden";
    });

    // Paste button
    container.querySelector("#vs-btn-paste").addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        inputEl.value = text;
        inputEl.dispatchEvent(new Event("input"));
      } catch (err) {
        statusEl.textContent = "Kan niet plakken. Gebruik Ctrl+V.";
        statusEl.className = "vs-status vs-status-error";
      }
    });

    // Clear button
    container.querySelector("#vs-btn-clear").addEventListener("click", () => {
      inputEl.value = "";
      inputEl.dispatchEvent(new Event("input"));
      outputEl.innerHTML = '<span class="vs-placeholder">Het vereenvoudigde resultaat verschijnt hier...</span>';
      wcOut.textContent = "0 woorden";
      copyBtn.disabled = true;
      statusEl.textContent = "";
      statusEl.className = "vs-status";
    });

    // Simplify button
    simplifyBtn.addEventListener("click", async () => {
      const text = inputEl.value.trim();
      if (!text) {
        statusEl.textContent = "Voer eerst een tekst in.";
        statusEl.className = "vs-status vs-status-error";
        return;
      }
      if (!vsState.webhookUrl) {
        statusEl.textContent = "Geen webhook URL geconfigureerd.";
        statusEl.className = "vs-status vs-status-error";
        return;
      }

      vsState.isProcessing = true;
      simplifyBtn.disabled = true;
      simplifyBtn.innerHTML = '<span class="vs-spinner"></span> <span>Bezig...</span>';
      outputEl.innerHTML = '<span class="vs-placeholder">Even geduld, de tekst wordt vereenvoudigd...</span>';
      statusEl.textContent = "Tekst wordt verwerkt...";
      statusEl.className = "vs-status vs-status-info";

      try {
        const resp = await fetch(vsState.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text,
            language_level: vsState.languageLevel,
          }),
        });

        if (!resp.ok) {
          throw new Error("Server antwoordde met status " + resp.status);
        }

        const data = await resp.json();

        // Support various response shapes from n8n
        let resultText = "";
        if (typeof data === "string") {
          resultText = data;
        } else if (data.text) {
          resultText = data.text;
        } else if (data.output) {
          resultText = data.output;
        } else if (data.result) {
          resultText = data.result;
        } else if (Array.isArray(data) && data.length > 0) {
          // n8n often returns an array of items
          const item = data[0];
          resultText = item.text || item.output || item.result || JSON.stringify(item);
        } else {
          resultText = JSON.stringify(data);
        }

        vsState.outputText = resultText;
        outputEl.textContent = resultText;
        const wcResult = countWords(resultText);
        vsState.wordCountOut = wcResult;
        wcOut.textContent = wcResult + " woorden";
        copyBtn.disabled = false;
        statusEl.textContent =
          "Klaar! " + vsState.wordCountIn + " \u2192 " + wcResult + " woorden.";
        statusEl.className = "vs-status vs-status-success";
      } catch (err) {
        console.error("[Versimpelaar] Error:", err);
        outputEl.innerHTML =
          '<span class="vs-placeholder vs-error-text">Er is een fout opgetreden. Probeer het opnieuw.</span>';
        statusEl.textContent = "Fout: " + err.message;
        statusEl.className = "vs-status vs-status-error";
      } finally {
        vsState.isProcessing = false;
        simplifyBtn.disabled = false;
        simplifyBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          <span>Vereenvoudig</span>`;
      }
    });

    // Copy button
    copyBtn.addEventListener("click", async () => {
      if (!vsState.outputText) return;
      try {
        await navigator.clipboard.writeText(vsState.outputText);
        copyBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Gekopieerd!`;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Kopieer`;
        }, 2000);
      } catch (err) {
        statusEl.textContent = "Kan niet kopiëren.";
        statusEl.className = "vs-status vs-status-error";
      }
    });

    // Escape key
    const escHandler = (e) => {
      if (e.key === "Escape" && !vsState.isProcessing) {
        closeVersimpelaar();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  function closeVersimpelaar() {
    const container = document.getElementById("vs-container");
    if (container) container.remove();
  }

  function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  // ── Utility ────────────────────────────────────────────────────────
  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
