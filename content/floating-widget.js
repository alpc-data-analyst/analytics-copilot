// =====================================================================
// Analytics Copilot — Floating Status Widget
// Shows active features when the extension panel is closed
// =====================================================================
(function () {
  "use strict";

  // Don't run in iframes
  if (window !== window.top) return;

  const WIDGET_ID = "analytics-copilot-widget";
  if (document.getElementById(WIDGET_ID)) return;

  let collapsed = false;

  // --- Create Shadow DOM host ---
  const host = document.createElement("div");
  host.id = WIDGET_ID;
  host.style.cssText =
    "all:initial !important;position:fixed !important;top:12px !important;right:12px !important;z-index:2147483647 !important;font-family:system-ui,-apple-system,sans-serif !important;";
  const shadow = host.attachShadow({ mode: "closed" });

  // --- Styles ---
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .pw {
      display: none;
      align-items: center;
      gap: 6px;
      background: rgba(20, 20, 40, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 6px 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #e0e0e0;
      cursor: default;
      user-select: none;
      max-width: 520px;
      flex-wrap: wrap;
      transition: all 0.25s ease;
    }

    .pw.visible { display: inline-flex; }

    /* --- Collapsed state --- */
    .pw.collapsed {
      padding: 0;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      position: relative;
      gap: 0;
      flex-wrap: nowrap;
    }
    .pw.collapsed .pw-items,
    .pw.collapsed .pw-collapse { display: none; }
    .pw.collapsed .pw-badge { display: flex; }
    .pw.collapsed .pw-logo { width: 22px; height: 22px; }

    /* --- Logo --- */
    .pw-logo {
      width: 18px;
      height: 18px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    /* --- Items container --- */
    .pw-items {
      display: contents;
    }

    /* --- Pills --- */
    .pw-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      line-height: 1.3;
    }

    .pw-pill-tt {
      background: rgba(147, 51, 234, 0.2);
      color: #c084fc;
      border: 1px solid rgba(147, 51, 234, 0.3);
    }
    .pw-pill-console {
      background: rgba(34, 197, 94, 0.2);
      color: #86efac;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .pw-pill-audit {
      background: rgba(251, 191, 36, 0.2);
      color: #fde68a;
      border: 1px solid rgba(251, 191, 36, 0.3);
    }
    .pw-pill-lab {
      background: rgba(59, 130, 246, 0.2);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    /* --- Collapse button --- */
    .pw-collapse {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 0 2px;
      font-size: 16px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s;
    }
    .pw-collapse:hover { color: #fff; }

    /* --- Badge (collapsed count) --- */
    .pw-badge {
      display: none;
      position: absolute;
      top: -5px;
      right: -5px;
      background: #ef4444;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      padding: 0 4px;
      align-items: center;
      justify-content: center;
      border: 2px solid rgba(20, 20, 40, 0.92);
    }
  `;

  // --- Widget DOM ---
  const container = document.createElement("div");
  container.className = "pw";

  const logoUrl = chrome.runtime.getURL("icons/icon48.png");
  container.innerHTML =
    `<img class="pw-logo" src="${logoUrl}" alt="C">` +
    `<div class="pw-items"></div>` +
    `<button class="pw-collapse" title="Minimizar">−</button>` +
    `<span class="pw-badge">0</span>`;

  shadow.appendChild(style);
  shadow.appendChild(container);

  const itemsEl = container.querySelector(".pw-items");
  const collapseBtn = container.querySelector(".pw-collapse");
  const badgeEl = container.querySelector(".pw-badge");

  // --- Collapse / Expand ---
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = true;
    container.classList.add("collapsed");
  });

  container.addEventListener("click", () => {
    if (collapsed) {
      collapsed = false;
      container.classList.remove("collapsed");
    }
  });

  // --- Render ---
  function render(states) {
    if (!states) {
      container.classList.remove("visible");
      return;
    }

    const pills = [];

    // Time Travel
    if (states.timeTravel && states.timeTravel.enabled) {
      let label = "Time Travel";
      if (states.timeTravel.target) {
        const d = new Date(states.timeTravel.target);
        label +=
          " " +
          d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) +
          " " +
          d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      }
      pills.push('<span class="pw-pill pw-pill-tt">\u23E9 ' + label + "</span>");
    }

    // Console Capture
    if (states.consoleCapture && states.consoleCapture.active) {
      pills.push('<span class="pw-pill pw-pill-console">\uD83D\uDCDF Capturando consola</span>');
    }

    // Cookie Audit
    if (states.audit && states.audit.active) {
      pills.push('<span class="pw-pill pw-pill-audit">\uD83C\uDF6A Cookie Audit</span>');
    }

    // Lab features
    if (states.lab) {
      var labParts = [];
      if (states.lab.gtm && states.lab.gtm.enabled) labParts.push("GTM");
      if (states.lab.dataLayer && states.lab.dataLayer.enabled) labParts.push("DL Push");
      var blocks = (states.lab.blocks || []).filter(function (b) { return b.enabled; });
      if (blocks.length > 0) {
        var knownPatterns = [
          { match: "googletagmanager.com", name: "GTM" },
          { match: "google-analytics.com", name: "GA4" },
          { match: "facebook.net",         name: "Meta" },
          { match: "doubleclick.net",      name: "Ads" },
          { match: "googleads",            name: "Ads" },
          { match: "tiktok.com",           name: "TikTok" },
          { match: "hotjar",              name: "Hotjar" },
          { match: "clarity",             name: "Clarity" },
        ];
        var blockNames = blocks.map(function (b) {
          for (var k = 0; k < knownPatterns.length; k++) {
            if (b.pattern && b.pattern.indexOf(knownPatterns[k].match) !== -1) return knownPatterns[k].name;
          }
          // Extraer dominio corto del pattern
          var m = b.pattern && b.pattern.match(/([a-z0-9-]+)\.[a-z]{2,}/i);
          return m ? m[1] : "custom";
        });
        // Deduplicar
        var unique = [];
        for (var u = 0; u < blockNames.length; u++) {
          if (unique.indexOf(blockNames[u]) === -1) unique.push(blockNames[u]);
        }
        labParts.push("\uD83D\uDEAB " + unique.join(", "));
      }

      if (labParts.length > 0) {
        pills.push('<span class="pw-pill pw-pill-lab">\uD83E\uDDEA Lab: ' + labParts.join(", ") + "</span>");
      }
    }

    if (pills.length === 0) {
      container.classList.remove("visible");
      return;
    }

    itemsEl.innerHTML = pills.join("");
    badgeEl.textContent = pills.length;
    container.classList.add("visible");
  }

  // --- Fetch status from background ---
  function fetchStatus(retries) {
    if (retries === undefined) retries = 2;
    try {
      chrome.runtime.sendMessage({ type: "widget-get-status" }, function (response) {
        if (chrome.runtime.lastError) {
          // Service worker may be waking up, retry after short delay
          if (retries > 0) setTimeout(function () { fetchStatus(retries - 1); }, 500);
          return;
        }
        if (response) render(response);
      });
    } catch (e) {
      // Extension context invalidated (e.g. extension updated/reloaded)
    }
  }

  // --- Listen for storage changes (Time Travel, Lab config) ---
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && (changes.timeTravelEnabled || changes.timeTravelTarget || changes.labConfig)) {
        fetchStatus();
      }
    });
  } catch (e) {}

  // --- Listen for pushed state updates (DL listener, Audit) ---
  try {
    chrome.runtime.onMessage.addListener(function (message) {
      if (message.type === "widget-state-update" && message.states) {
        render(message.states);
      }
    });
  } catch (e) {}

  // --- Mount and initial fetch ---
  function mount() {
    if (!document.documentElement) return;
    document.documentElement.appendChild(host);
    fetchStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
