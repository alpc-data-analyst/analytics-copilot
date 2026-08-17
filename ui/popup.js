const status = document.getElementById("status");

// =============================================
// HOST PERMISSIONS — Solicitar permisos bajo demanda
// =============================================

const HOST_ORIGINS = ["http://*/*", "https://*/*"];

// Solo comprueba. Seguro de llamar en cualquier momento (incluido al abrir el popup).
async function hasHostPermissions() {
  try {
    return await chrome.permissions.contains({ origins: HOST_ORIGINS });
  } catch (e) { return false; }
}

// Comprueba y, si falta, PIDE el permiso.
// IMPORTANTE: chrome.permissions.request() solo puede llamarse desde un gesto del
// usuario (click). Si se llama al cargar el popup, Chrome cierra el popup al instante
// — por eso esta función nunca debe usarse en los hooks automáticos de navigateTo().
async function ensureHostPermissions() {
  try {
    const has = await chrome.permissions.contains({ origins: HOST_ORIGINS });
    if (has) return true;
    return await chrome.permissions.request({ origins: HOST_ORIGINS });
  } catch (e) { return false; }
}

// Pinta un aviso con botón para conceder permisos dentro de un contenedor.
// El click del botón sí es un gesto válido, así que ahí la petición funciona.
function renderPermissionPrompt(container, onGranted) {
  if (!container) return;
  container.innerHTML =
    '<div class="perm-prompt">' +
    '<p class="perm-prompt-text">Esta herramienta necesita acceso a la página para funcionar.</p>' +
    '<button class="btn btn-primary perm-prompt-btn">Conceder permisos</button>' +
    '</div>';
  const btn = container.querySelector(".perm-prompt-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      const granted = await ensureHostPermissions();
      if (granted) {
        onGranted();
      } else {
        container.innerHTML = '<div class="dl-empty">Permisos no concedidos</div>';
      }
    });
  }
}


function showStatus(message, type) {
  status.textContent = message;
  status.className = `status ${type}`;
  status.classList.remove("hidden");
  setTimeout(() => status.classList.add("hidden"), 4000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function ICON_SVG(name) {
  return '<svg class="icon icon-sm"><use href="#i-' + name + '"/></svg>';
}

// =============================================
// TABS
// =============================================

const IS_PANEL = document.body.classList.contains("panel-mode");

// ---- Home grid navigation ----
const TAB_MAP = { tags: "tabTags", timetravel: "tabTimeTravel", cache: "tabCache", consent: "tabConsent", crossdomain: "tabCrossDomain", lab: "tabLab", html: "tabHtml", console: "tabConsole", events: "tabEvents" };
const homeGrid = document.getElementById("homeGrid");

function navigateTo(tabKey, opts) {
  const target = TAB_MAP[tabKey];
  if (!target) return;
  const el = document.getElementById(target);
  if (!el) return;

  // Hide home, show tool
  homeGrid.classList.add("hidden");
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
  el.classList.remove("hidden");

  // Hook: load state for specific tabs.
  // Envuelto en try/catch: si un hook falla no debe dejar el popup a medias.
  const runHook = () => {
    try {
      if (tabKey === "timetravel") loadTimeTravelState();
      if (tabKey === "cache") updateCacheSiteBadge();
      if (tabKey === "consent") runConsentScan();
      if (tabKey === "crossdomain") caLoadState();
      if (tabKey === "lab") labLoadConfig();
      if (tabKey === "tags") runTagScan();
      if (tabKey === "console") consoleOnOpen();
      if (tabKey === "events") evEnsureInit();
    } catch (e) {
      console.error("[Copilot] Error al abrir la herramienta:", tabKey, e);
    }
  };

  // Al restaurar la última herramienta nada más abrir el popup, dejamos que
  // pinte primero y lanzamos el scan después: la apertura nunca depende de él.
  if (opts && opts.defer) {
    requestAnimationFrame(() => setTimeout(runHook, 0));
  } else {
    runHook();
  }

  // Persist last open tab so it restores on popup reopen
  chrome.storage.local.set({ lastOpenTab: tabKey });
}

function navigateHome() {
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
  homeGrid.classList.remove("hidden");
  chrome.storage.local.set({ lastOpenTab: null });
}

// Home cards
document.querySelectorAll(".home-card").forEach((card) => {
  card.addEventListener("click", () => navigateTo(card.dataset.tab));
});

// Back buttons (injected at top of each tab-content)
document.querySelectorAll(".tab-content").forEach((tab) => {
  const backBar = document.createElement("div");
  backBar.className = "tool-back-bar";
  const backBtn = document.createElement("button");
  backBtn.className = "tool-back-btn";
  backBtn.innerHTML = "← Inicio";
  backBtn.addEventListener("click", navigateHome);
  backBar.appendChild(backBtn);
  tab.insertBefore(backBar, tab.firstChild);
});

// =============================================
// RESTORE LAST TAB + TIME TRAVEL HOME WARNING
// =============================================

(async function initHomeState() {
  try {
    const data = await chrome.storage.local.get(["lastOpenTab", "timeTravelEnabled", "timeTravelTarget"]);

    // Restore last open tab. `defer: true` → se pinta la herramienta al momento
    // y su scan se lanza tras el primer render, para que abrir el popup nunca
    // dependa de él.
    if (data.lastOpenTab && TAB_MAP[data.lastOpenTab]) {
      navigateTo(data.lastOpenTab, { defer: true });
    }

    // Show Time Travel warning on home screen if active
    if (data.timeTravelEnabled && data.timeTravelTarget) {
      insertTtWarning(new Date(data.timeTravelTarget));
    }

    // Show Lab warning on home screen if anything is active
    updateLabHomeBanner();
  } catch (e) {}
})();

// Listen for Time Travel state changes to update the home warning
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.timeTravelEnabled) {
    const existing = document.getElementById("homeTtWarning");
    if (changes.timeTravelEnabled.newValue === false && existing) {
      existing.remove();
    }
    if (changes.timeTravelEnabled.newValue === true && !existing) {
      // Read the target timestamp (might be in same batch or already stored)
      const targetTs = changes.timeTravelTarget?.newValue;
      if (targetTs) {
        insertTtWarning(new Date(targetTs));
      } else {
        // Target was set in a previous call, read from storage
        chrome.storage.local.get(["timeTravelTarget"], (data) => {
          if (data.timeTravelTarget && !document.getElementById("homeTtWarning")) {
            insertTtWarning(new Date(data.timeTravelTarget));
          }
        });
      }
    }
  }
  // Lab config changes
  if (changes.labConfig) {
    updateLabHomeBanner();
  }
});

// ---- Lab home banner ----
async function updateLabHomeBanner() {
  // Remove existing banner if any
  const existing = document.getElementById("homeLabWarning");
  if (existing) existing.remove();

  try {
    const { labConfig } = await chrome.storage.local.get("labConfig");
    if (!labConfig) return;

    // Collect active items
    const activeItems = [];

    // Check blocks
    const activeBlocks = (labConfig.blocks || []).filter(b => b.enabled);
    if (activeBlocks.length > 0) {
      activeItems.push(`Bloqueando ${activeBlocks.length} request${activeBlocks.length > 1 ? "s" : ""}`);
    }

    // Check GTM injection
    if (labConfig.gtm?.enabled && labConfig.gtm?.containerId) {
      activeItems.push(`GTM: ${labConfig.gtm.containerId}`);
    }

    // Check dataLayer push
    if (labConfig.dataLayer?.enabled && labConfig.dataLayer?.code) {
      activeItems.push(`Push al dataLayer`);
    }

    // Check script injection
    if (labConfig.script?.enabled && labConfig.script?.code) {
      activeItems.push(`Script inyectado`);
    }

    if (activeItems.length === 0) return;

    // Create banner
    const banner = document.createElement("div");
    banner.className = "home-lab-warning";
    banner.id = "homeLabWarning";
    banner.innerHTML = `
      <span class="home-lab-warning-icon"><svg><use href="#i-flask"/></svg></span>
      <div class="home-lab-warning-body">
        <span class="home-lab-warning-title">Lab activo</span>
        <span class="home-lab-warning-items">${activeItems.join(" · ")}</span>
      </div>
    `;
    banner.addEventListener("click", () => navigateTo("lab"));
    homeGrid.appendChild(banner);
  } catch (e) {}
}

function insertTtWarning(target) {
  const ttWarning = document.createElement("div");
  ttWarning.className = "home-tt-warning";
  ttWarning.id = "homeTtWarning";
  ttWarning.innerHTML = `
    <span class="home-tt-warning-icon"><svg><use href="#i-clock"/></svg></span>
    <span class="home-tt-warning-text">Time Travel activo: <strong>${target.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })} ${target.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false })}</strong></span>
  `;
  ttWarning.addEventListener("click", () => navigateTo("timetravel"));
  homeGrid.appendChild(ttWarning);
}

// =============================================
// TAG SCANNER
// =============================================

const tagsScanBtn = document.getElementById("tagsScanBtn");
const tagsResults = document.getElementById("tagsResults");
const tagsUrl = document.getElementById("tagsUrl");

// Tag definitions: how to detect each tool
const TAG_DEFINITIONS = [
  // --- Google ---
  {
    name: "Google Tag Manager",
    category: "google",
    icon: `<img class="tags-brand-icon" src="../icons/tool-gtm.png" alt="GTM">`,
    detect: (ctx) => {
      const ids = new Set();
      // Script tags
      ctx.scripts.forEach((s) => {
        const m = s.match(/googletagmanager\.com\/gtm\.js\?.*id=(GTM-[A-Z0-9]+)/);
        if (m) ids.add(m[1]);
      });
      // Noscript iframes
      ctx.iframes.forEach((s) => {
        const m = s.match(/googletagmanager\.com\/ns\.html\?.*id=(GTM-[A-Z0-9]+)/);
        if (m) ids.add(m[1]);
      });
      // Inline scripts
      ctx.inline.forEach((s) => {
        const ms = s.match(/GTM-[A-Z0-9]{4,}/g);
        if (ms) ms.forEach((id) => ids.add(id));
      });
      // google_tag_manager global
      ctx.gtmKeys.forEach((k) => { if (k.startsWith("GTM-")) ids.add(k); });
      return [...ids];
    },
  },
  {
    name: "Google Analytics 4",
    category: "google",
    icon: `<img class="tags-brand-icon" src="../icons/tool-ga4.png" alt="GA4">`,
    detect: (ctx) => {
      const ids = new Set();
      // Script tags
      ctx.scripts.forEach((s) => {
        const m = s.match(/gtag\/js\?id=(G-[A-Z0-9]+)/);
        if (m) ids.add(m[1]);
      });
      // Inline scripts
      ctx.inline.forEach((s) => {
        const ms = s.match(/(G-[A-Z0-9]{5,})/g);
        if (ms) ms.forEach((id) => ids.add(id));
      });
      // dataLayer config calls
      ctx.dataLayerConfigs.forEach((id) => {
        if (id.startsWith("G-") || id.startsWith("GT-")) ids.add(id);
      });
      // google_tag_manager keys (GTM loads GA4 here)
      ctx.gtmKeys.forEach((k) => {
        if (k.startsWith("G-") || k.startsWith("GT-")) ids.add(k);
      });
      // google_tag_data internal registry
      ctx.gtagDataIds.forEach((k) => {
        if (k.startsWith("G-") || k.startsWith("GT-")) ids.add(k);
      });
      return [...ids];
    },
  },
  {
    name: "Google Ads",
    category: "google",
    icon: `<img class="tags-brand-icon" src="../icons/tool-google-ads.png" alt="Google Ads">`,
    detect: (ctx) => {
      const ids = new Set();
      // Script tags
      ctx.scripts.forEach((s) => {
        const m = s.match(/gtag\/js\?id=(AW-[0-9]+)/);
        if (m) ids.add(m[1]);
      });
      // Inline scripts
      ctx.inline.forEach((s) => {
        const ms = s.match(/AW-[0-9]{5,}/g);
        if (ms) ms.forEach((id) => ids.add(id));
      });
      // dataLayer config
      ctx.dataLayerConfigs.forEach((id) => {
        if (id.startsWith("AW-")) ids.add(id);
      });
      // google_tag_manager keys (GTM loads Ads here)
      ctx.gtmKeys.forEach((k) => {
        if (k.startsWith("AW-")) ids.add(k);
      });
      // google_tag_data internal registry
      ctx.gtagDataIds.forEach((k) => {
        if (k.startsWith("AW-")) ids.add(k);
      });
      return [...ids];
    },
  },
  {
    name: "Universal Analytics (Legacy)",
    category: "google",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#F9AB00"/><rect x="5" y="13" width="3.5" height="6" rx="1" fill="#fff"/><rect x="10.25" y="9" width="3.5" height="10" rx="1" fill="#fff"/><rect x="15.5" y="5" width="3.5" height="14" rx="1" fill="#fff"/></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      // Only count real UA-XXXXX-X IDs from inline scripts
      ctx.inline.forEach((s) => {
        const ms = s.match(/UA-[0-9]+-[0-9]+/g);
        if (ms) ms.forEach((id) => ids.add(id));
      });
      // ga() global with actual tracker IDs
      if (ctx.globals.includes("ga") && ctx.gaIds) {
        ctx.gaIds.forEach((id) => ids.add(id));
      }
      // google_tag_data
      ctx.gtagDataIds.forEach((k) => {
        if (k.startsWith("UA-")) ids.add(k);
      });
      return [...ids];
    },
  },
  // --- Meta ---
  {
    name: "Meta Pixel",
    category: "meta",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path d="M15.5 12.5h-2v6h-3v-6H9v-2.5h1.5V8.5c0-1.5 1-2.5 2.5-2.5h2v2.5h-1.5c-.3 0-.5.2-.5.5v1h2l-.5 2.5z" fill="#fff"/></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      // Only collect numeric pixel IDs
      ctx.inline.forEach((s) => {
        const ms = s.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,})['"]/g);
        if (ms) {
          ms.forEach((m) => {
            const id = m.match(/['"](\d{10,})['"]/);
            if (id) ids.add(id[1]);
          });
        }
      });
      // Also check fbq._pixelById or fbq.instance.pixelsByID
      if (ctx.fbqPixelIds) {
        ctx.fbqPixelIds.forEach((id) => ids.add(id));
      }
      return [...ids];
    },
  },
  // --- Other common tools ---
  {
    name: "Hotjar",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF3C00"/><path d="M14 6c0 2-4 3-4 6h4c0-3 4-4 4-6s-2-3-4-3-4 1-4 3" fill="#fff" opacity="0.9"/><circle cx="12" cy="17" r="2" fill="#fff"/></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/hotjar\.com.*?(\d{6,})/);
        if (m) ids.add(m[1]);
      });
      if (ctx.globals.includes("hj")) ids.add("hj()");
      return [...ids];
    },
  },
  {
    name: "Microsoft Clarity",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0078D4"/><text x="12" y="16" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">C</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        if (s.includes("clarity.ms/tag/")) {
          const m = s.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
          if (m) ids.add(m[1]);
        }
      });
      return [...ids];
    },
  },
  {
    name: "TikTok Pixel",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#010101"/><text x="12" y="16" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">Tk</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      // Extract pixel ID from ttq.load('PIXEL_ID') in inline scripts
      ctx.inline.forEach((s) => {
        const m = s.match(/ttq\.load\s*\(\s*['"]([A-Z0-9]+)['"]/);
        if (m) ids.add(m[1]);
      });
      // Extract from ttq runtime object
      if (ctx.ttqPixelIds) {
        ctx.ttqPixelIds.forEach((id) => ids.add(id));
      }
      // If we detect TikTok script/global but couldn't extract ID, show as detected
      if (ids.size === 0) {
        const hasTikTokScript = ctx.scripts.some((s) => s.includes("analytics.tiktok.com"));
        const hasTtqGlobal = ctx.globals.includes("ttq");
        if (hasTikTokScript || hasTtqGlobal) ids.add("ID no detectado");
      }
      return [...ids];
    },
  },
  {
    name: "Pinterest Tag",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#E60023"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">P</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        if (s.includes("pintrk") || s.includes("s.pinimg.com/ct/core.js")) ids.add("pintrk");
      });
      if (ctx.globals.includes("pintrk")) ids.add("pintrk");
      return [...ids];
    },
  },
  {
    name: "LinkedIn Insight",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0A66C2"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">in</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        if (s.includes("snap.licdn.com/li.lms-analytics")) ids.add("lms-analytics");
      });
      if (ctx.globals.includes("_linkedin_data_partner_ids")) ids.add("linkedin");
      ctx.inline.forEach((s) => {
        const m = s.match(/_linkedin_partner_id\s*=\s*['"]?(\d+)/);
        if (m) ids.add(m[1]);
      });
      return [...ids];
    },
  },
  // --- Additional Ad pixels ---
  {
    name: "Microsoft Ads (Bing UET)",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#00A4EF"/><text x="12" y="16" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">MS</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/bat\.bing\.com\/bat\.js.*?ti=(\d+)/);
        if (m) ids.add(m[1]);
      });
      ctx.inline.forEach((s) => {
        const m = s.match(/uetq.*?['"]setAccount['"]\s*,\s*['"](\d+)['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("uetq") || ctx.scripts.some(s => s.includes("bat.bing.com")))) {
        ids.add("UET activo");
      }
      return [...ids];
    },
  },
  {
    name: "X / Twitter Pixel",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#000"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">𝕏</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/twq\s*\(\s*['"](?:init|config)['"]\s*,\s*['"]([a-z0-9]+)['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("twq") || ctx.scripts.some(s => s.includes("static.ads-twitter.com")))) {
        ids.add("twq activo");
      }
      return [...ids];
    },
  },
  {
    name: "Snap Pixel",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FFFC00"/><text x="12" y="17" text-anchor="middle" fill="#000" font-size="13" font-weight="bold">👻</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/snaptr\s*\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]+)['"]/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("snaptr") || ctx.scripts.some(s => s.includes("sc-static.net/scevent")))) {
        ids.add("snaptr activo");
      }
      return [...ids];
    },
  },
  {
    name: "Reddit Pixel",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF4500"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">R</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/rdt\s*\(\s*['"]init['"]\s*,\s*['"](t2_[a-z0-9]+)['"]/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("rdt") || ctx.scripts.some(s => s.includes("redditstatic.com/ads/pixel")))) {
        ids.add("rdt activo");
      }
      return [...ids];
    },
  },
  {
    name: "Criteo",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF8300"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">C</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("criteo_q") || ctx.scripts.some(s => s.includes("static.criteo.net"))) {
        ids.add("criteo_q");
      }
      return [...ids];
    },
  },
  {
    name: "Outbrain",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#EE6723"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Ob</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.scripts.some(s => s.includes("outbrain.com") || s.includes("obtp.js"))) {
        ids.add("Outbrain");
      }
      return [...ids];
    },
  },
  {
    name: "Taboola",
    category: "ads",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#043249"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">Tb</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("_taboola") || ctx.scripts.some(s => s.includes("cdn.taboola.com"))) {
        ids.add("_taboola");
      }
      return [...ids];
    },
  },

  // --- Additional Analytics ---
  {
    name: "Adobe Analytics",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FA0F00"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">A</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/s\.account\s*=\s*['"]([a-z0-9,]+)['"]/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("s_account") || ctx.scripts.some(s => /(AppMeasurement|s_code)\.js|omtrdc\.net/.test(s)))) {
        ids.add("AppMeasurement");
      }
      return [...ids];
    },
  },
  {
    name: "Adobe Launch / Tags",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#ED2224"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">AL</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/assets\.adobedtm\.com\/([a-f0-9]+)\/[^/]+\/launch-/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && ctx.globals.includes("_satellite")) {
        ids.add("_satellite");
      }
      return [...ids];
    },
  },
  {
    name: "Segment",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#52BD95"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">S</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/cdn\.segment\.com\/analytics\.js\/v1\/([A-Za-z0-9]+)\//);
        if (m) ids.add(m[1]);
      });
      return [...ids];
    },
  },
  {
    name: "Amplitude",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#1E61F0"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">A</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/amplitude\.(?:getInstance\(\)\.)?init\s*\(\s*['"]([a-z0-9]+)['"]/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("amplitude") || ctx.scripts.some(s => s.includes("cdn.amplitude.com")))) {
        ids.add("amplitude");
      }
      return [...ids];
    },
  },
  {
    name: "Mixpanel",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#7856FF"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Mx</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/mixpanel\.init\s*\(\s*['"]([a-f0-9]+)['"]/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("mixpanel") || ctx.scripts.some(s => s.includes("cdn.mxpnl.com")))) {
        ids.add("mixpanel");
      }
      return [...ids];
    },
  },
  {
    name: "Heap Analytics",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#3B5CDE"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">H</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/heap\.load\s*\(\s*['"](\d+)['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("heap") || ctx.scripts.some(s => s.includes("heapanalytics.com")))) {
        ids.add("heap");
      }
      return [...ids];
    },
  },
  {
    name: "FullStory",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF9100"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">FS</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/_fs_org\s*=\s*['"]([A-Z0-9]+)['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("FS") || ctx.scripts.some(s => s.includes("edge.fullstory.com")))) {
        ids.add("FS");
      }
      return [...ids];
    },
  },
  {
    name: "Contentsquare",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#2B2D3A"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Cs</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("_uxa") || ctx.scripts.some(s => /contentsquare\.net|content-square/.test(s))) {
        ids.add("_uxa");
      }
      return [...ids];
    },
  },
  {
    name: "Mouseflow",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#1E90FF"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Mf</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/cdn\.mouseflow\.com\/projects\/([a-f0-9-]+)/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && ctx.globals.includes("_mfq")) {
        ids.add("_mfq");
      }
      return [...ids];
    },
  },
  {
    name: "Yandex Metrica",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF0000"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">Y</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/ym\s*\(\s*(\d+)\s*,\s*['"]init['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("ym") || ctx.scripts.some(s => s.includes("mc.yandex.ru")))) {
        ids.add("ym");
      }
      return [...ids];
    },
  },
  {
    name: "Matomo",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#3152A0"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">M</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("_paq") || ctx.scripts.some(s => /\/(matomo|piwik)\.js/.test(s))) {
        ids.add("_paq");
      }
      return [...ids];
    },
  },

  // --- A/B Testing ---
  {
    name: "Optimizely",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0037FF"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Op</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/cdn\.optimizely\.com\/(?:js|public)\/(\d+)\.js/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("optimizely") || ctx.scripts.some(s => s.includes("cdn.optimizely.com")))) {
        ids.add("optimizely");
      }
      return [...ids];
    },
  },
  {
    name: "VWO",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#EE4C2B"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">VWO</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/dev\.visualwebsiteoptimizer\.com\/lib\/(\d+)\.js/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("VWO") || ctx.globals.includes("_vwo_code"))) {
        ids.add("VWO");
      }
      return [...ids];
    },
  },
  {
    name: "AB Tasty",
    category: "analytics",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#5A2EFF"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">AB</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("ABTasty") || ctx.scripts.some(s => s.includes("try.abtasty.com"))) {
        ids.add("ABTasty");
      }
      return [...ids];
    },
  },

  // --- Chatbots & customer engagement ---
  {
    name: "Intercom",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#1F8DED"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">ic</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/app_id\s*:\s*['"]([a-z0-9]+)['"]/);
        if (m && s.toLowerCase().includes("intercom")) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("Intercom") || ctx.scripts.some(s => s.includes("widget.intercom.io")))) {
        ids.add("Intercom");
      }
      return [...ids];
    },
  },
  {
    name: "Zendesk Chat / Widget",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#03363D"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Zd</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/static\.zdassets\.com\/ekr\/snippet\.js\?key=([a-f0-9-]+)/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("zE") || ctx.globals.includes("$zopim") || ctx.scripts.some(s => /static\.zdassets\.com|v2\.zopim\.com/.test(s)))) {
        ids.add("zE");
      }
      return [...ids];
    },
  },
  {
    name: "Drift",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FE3F85"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">D</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/js\.driftt?\.com\/include\/[^/]+\/([a-z0-9]+)\.js/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("drift") || ctx.scripts.some(s => s.includes("driftt.com") || s.includes("js.drift.com")))) {
        ids.add("drift");
      }
      return [...ids];
    },
  },
  {
    name: "Crisp",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#1972F5"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">C</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.inline.forEach((s) => {
        const m = s.match(/CRISP_WEBSITE_ID\s*=\s*['"]([a-f0-9-]+)['"]/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("$crisp") || ctx.scripts.some(s => s.includes("client.crisp.chat")))) {
        ids.add("$crisp");
      }
      return [...ids];
    },
  },
  {
    name: "Tawk.to",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#01A78F"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Tw</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/embed\.tawk\.to\/([a-f0-9]+)\/([a-z0-9]+)/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("Tawk_API") || ctx.scripts.some(s => s.includes("embed.tawk.to")))) {
        ids.add("Tawk_API");
      }
      return [...ids];
    },
  },
  {
    name: "Tidio",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0566FF"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">Ti</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/code\.tidio\.co\/([a-z0-9]+)\.js/i);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("tidioChatApi") || ctx.scripts.some(s => s.includes("tidio.co")))) {
        ids.add("tidio");
      }
      return [...ids];
    },
  },
  {
    name: "LiveChat",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FFD000"/><text x="12" y="17" text-anchor="middle" fill="#000" font-size="12" font-weight="bold">Lc</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("LiveChatWidget") || ctx.scripts.some(s => /cdn\.livechatinc\.com|cdn\.livechat/.test(s))) {
        ids.add("LiveChat");
      }
      return [...ids];
    },
  },

  // --- Marketing automation / CDP / TMS ---
  {
    name: "HubSpot",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF7A59"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Hs</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/js\.hs-scripts\.com\/(\d+)\.js/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("_hsq") || ctx.globals.includes("HubSpotConversations") || ctx.scripts.some(s => /js\.(hsforms|hs-scripts|hs-analytics)\./.test(s)))) {
        ids.add("HubSpot");
      }
      return [...ids];
    },
  },
  {
    name: "Klaviyo",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#000"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">K</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/static\.klaviyo\.com\/onsite\/js\/([a-zA-Z0-9]+)\/klaviyo\.js/);
        if (m) ids.add(m[1]);
        const m2 = s.match(/klaviyo\.js\?company_id=([a-zA-Z0-9]+)/);
        if (m2) ids.add(m2[1]);
      });
      if (ids.size === 0 && (ctx.globals.includes("_learnq") || ctx.scripts.some(s => s.includes("klaviyo.com")))) {
        ids.add("Klaviyo");
      }
      return [...ids];
    },
  },
  {
    name: "Tealium iQ",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0071CE"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">Te</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      ctx.scripts.forEach((s) => {
        const m = s.match(/tags\.tiqcdn\.com\/utag\/([^/]+)\/([^/]+)\//);
        if (m) ids.add(m[1] + "/" + m[2]);
      });
      if (ids.size === 0 && (ctx.globals.includes("utag") || ctx.scripts.some(s => s.includes("tiqcdn.com")))) {
        ids.add("utag");
      }
      return [...ids];
    },
  },

  // --- Performance / error tracking ---
  {
    name: "Datadog RUM",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#632CA6"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Dd</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("DD_RUM") || ctx.scripts.some(s => s.includes("datadoghq-browser-agent.com"))) {
        ids.add("DD_RUM");
      }
      return [...ids];
    },
  },
  {
    name: "Sentry",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#362D59"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Se</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("Sentry") || ctx.scripts.some(s => s.includes("browser.sentry-cdn.com"))) {
        ids.add("Sentry");
      }
      return [...ids];
    },
  },
  {
    name: "New Relic Browser",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#008C99"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold">Nr</text></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      if (ctx.globals.includes("NREUM") || ctx.scripts.some(s => s.includes("js-agent.newrelic.com"))) {
        ids.add("NREUM");
      }
      return [...ids];
    },
  },

  {
    name: "Cookie Consent (CMP)",
    category: "tools",
    icon: `<svg class="dl-icon" viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#6B7280"/><g transform="translate(4,4) scale(0.67)" stroke="#fff" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10c0-.5-.04-1-.11-1.5a3 3 0 0 1-4.39-3.39A3 3 0 0 1 13.5 2.11c-.5-.07-1-.11-1.5-.11z"/><circle cx="8.5" cy="10.5" r=".8" fill="#fff"/><circle cx="15" cy="15" r=".8" fill="#fff"/><circle cx="10" cy="16" r=".8" fill="#fff"/></g></svg>`,
    detect: (ctx) => {
      const ids = new Set();
      const cmps = [
        { pattern: "cookiebot", name: "Cookiebot" },
        { pattern: "onetrust", name: "OneTrust" },
        { pattern: "cookieconsent", name: "CookieConsent" },
        { pattern: "iubenda", name: "iubenda" },
        { pattern: "didomi", name: "Didomi" },
        { pattern: "quantcast", name: "Quantcast" },
        { pattern: "trustarc", name: "TrustArc" },
        { pattern: "usercentrics", name: "Usercentrics" },
      ];
      const allSrc = [...ctx.scripts, ...ctx.inline].join(" ").toLowerCase();
      cmps.forEach((c) => {
        if (allSrc.includes(c.pattern)) ids.add(c.name);
      });
      return [...ids];
    },
  },
];

// Function executed in MAIN world to gather detection context
function scanPageTags() {
  var scriptSrcs = [];
  var inlineScripts = [];
  document.querySelectorAll("script[src]").forEach(function (s) { scriptSrcs.push(s.src); });
  document.querySelectorAll("script:not([src])").forEach(function (s) {
    if (s.textContent.length < 50000) inlineScripts.push(s.textContent);
  });

  var globals = [];
  var checkGlobals = [
    // Google & Meta
    "dataLayer", "gtag", "ga", "google_tag_manager", "google_tag_data", "fbq",
    // Other ad pixels
    "hj", "clarity", "ttq", "pintrk", "_linkedin_data_partner_ids",
    "uetq", "snaptr", "twq", "rdt", "criteo_q", "_taboola",
    // Analytics / UX
    "_satellite", "s_account", "amplitude", "mixpanel", "heap",
    "FS", "_uxa", "_mfq", "ym", "_paq",
    // A/B testing
    "optimizely", "VWO", "_vwo_code", "ABTasty", "dynamicYield", "kameleoon",
    // Chatbots & customer engagement
    "Intercom", "zE", "drift", "Tawk_API", "tidioChatApi", "LiveChatWidget",
    // Marketing / CDP / TMS
    "_hsq", "HubSpotConversations", "_learnq", "utag", "analytics",
    // Performance
    "DD_RUM", "Sentry", "NREUM",
  ];
  checkGlobals.forEach(function (g) {
    try { if (window[g] !== undefined) globals.push(g); } catch (e) {}
  });
  // Globals with special chars need bracket access
  try { if (window["$crisp"] !== undefined) globals.push("$crisp"); } catch (e) {}
  try { if (window["$zopim"] !== undefined) globals.push("$zopim"); } catch (e) {}

  // Extract ALL Google IDs from google_tag_manager (most reliable for GTM-loaded tags)
  var gtmKeys = [];
  try {
    if (window.google_tag_manager) {
      gtmKeys = Object.keys(window.google_tag_manager).filter(function (k) {
        return /^(GTM-|G-|GT-|AW-|DC-|UA-)/.test(k);
      });
    }
  } catch (e) {}

  // Extract IDs from google_tag_data (internal registry used by gtag/GTM)
  var gtagDataIds = [];
  try {
    if (window.google_tag_data) {
      // tidr = tag ID registry
      if (window.google_tag_data.tidr) {
        Object.keys(window.google_tag_data.tidr).forEach(function (k) {
          if (/^(G-|GT-|AW-|UA-)/.test(k)) gtagDataIds.push(k);
        });
      }
      // aw_conversions
      if (window.google_tag_data.aw_conversions) {
        Object.keys(window.google_tag_data.aw_conversions).forEach(function (k) {
          if (/^AW-/.test(k)) gtagDataIds.push(k);
        });
      }
    }
  } catch (e) {}

  // Extract dataLayer config IDs
  var dlConfigs = [];
  try {
    if (window.dataLayer && Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach(function (entry) {
        if (Array.isArray(entry) && entry[0] === "config" && entry[1]) {
          dlConfigs.push(String(entry[1]));
        }
      });
    }
  } catch (e) {}

  // Extract UA IDs from ga()
  var gaIds = [];
  try {
    if (window.ga && typeof window.ga.getAll === "function") {
      gaIds = window.ga.getAll().map(function (t) { return t.get("trackingId"); });
    }
  } catch (e) {}

  // Scan iframes for GTM (noscript)
  var iframeSrcs = [];
  document.querySelectorAll("iframe[src]").forEach(function (f) { iframeSrcs.push(f.src); });

  // Deep scan google_tag_data for ALL AW- IDs
  var allGoogleIds = [];
  try {
    if (window.google_tag_data) {
      var gtd = window.google_tag_data;
      // Scan all top-level keys for objects containing AW-/G- IDs
      Object.keys(gtd).forEach(function (topKey) {
        try {
          var val = gtd[topKey];
          if (val && typeof val === "object") {
            Object.keys(val).forEach(function (k) {
              if (/^(G-|GT-|AW-|UA-)/.test(k)) allGoogleIds.push(k);
            });
          }
        } catch (e) {}
      });
    }
  } catch (e) {}

  // Scan all script srcs for any AW- patterns
  scriptSrcs.forEach(function (s) {
    var ms = s.match(/AW-\d{5,}/g);
    if (ms) ms.forEach(function (id) { allGoogleIds.push(id); });
    var gs = s.match(/G-[A-Z0-9]{5,}/g);
    if (gs) gs.forEach(function (id) { allGoogleIds.push(id); });
  });

  // Extract TikTok Pixel IDs from ttq runtime
  var ttqPixelIds = [];
  try {
    if (window.ttq) {
      // ttq._i is an array of initialized pixel configs
      if (window.ttq._i && Array.isArray(window.ttq._i)) {
        window.ttq._i.forEach(function (item) {
          if (item && item[0]) ttqPixelIds.push(item[0]);
        });
      }
      // Alternative: ttq._o has pixel instances keyed by ID
      if (ttqPixelIds.length === 0 && window.ttq._o) {
        Object.keys(window.ttq._o).forEach(function (k) {
          if (/^[A-Z0-9]+$/.test(k)) ttqPixelIds.push(k);
        });
      }
    }
  } catch (e) {}

  // Extract Meta Pixel IDs from fbq runtime
  var fbqPixelIds = [];
  try {
    if (window.fbq) {
      // fbq.instance.pixelsByID has all initialized pixels
      if (window.fbq.instance && window.fbq.instance.pixelsByID) {
        fbqPixelIds = Object.keys(window.fbq.instance.pixelsByID);
      }
      // Alternative: fbq._pixelById
      if (fbqPixelIds.length === 0 && window.fbq._pixelById) {
        fbqPixelIds = Object.keys(window.fbq._pixelById);
      }
      // Alternative: fbq.getState and iterate
      if (fbqPixelIds.length === 0 && typeof window.fbq.getState === "function") {
        try {
          var state = window.fbq.getState();
          if (state && state.pixels) {
            state.pixels.forEach(function (p) { if (p.id) fbqPixelIds.push(p.id); });
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return {
    scripts: scriptSrcs,
    iframes: iframeSrcs,
    inline: inlineScripts,
    globals: globals,
    dataLayerConfigs: dlConfigs,
    gaIds: gaIds,
    gtmKeys: gtmKeys,
    gtagDataIds: [].concat(gtagDataIds, allGoogleIds),
    fbqPixelIds: fbqPixelIds,
    ttqPixelIds: ttqPixelIds,
    url: location.href,
  };
}

async function runTagScan() {
  tagsResults.innerHTML = `<div class="tags-loading">Escaneando página...</div>`;

  // Solo comprobar (nunca pedir aquí): esta función corre al abrir el popup y
  // un permissions.request() sin gesto de usuario cerraría el popup.
  if (!await hasHostPermissions()) {
    renderPermissionPrompt(tagsResults, runTagScan);
    return;
  }

  try {
    const tabId = await getActiveTabId();
    if (!tabId) {
      tagsResults.innerHTML = `<div class="dl-empty">No se pudo acceder a la pestaña</div>`;
      return;
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scanPageTags,
      world: "MAIN",
    });

    const ctx = result?.result;
    if (!ctx) {
      tagsResults.innerHTML = `<div class="dl-empty">No se pudo escanear la página</div>`;
      return;
    }

    // Show URL — clean hostname without www. prefix
    try {
      const u = new URL(ctx.url);
      tagsUrl.textContent = u.hostname.replace(/^www\./, "");
    } catch (e) {
      tagsUrl.textContent = ctx.url;
    }

    // Sync: load blocks from storage and reconcile with declarativeNetRequest rules
    let labBlockedPatterns = [];
    try {
      const { labConfig: lc } = await chrome.storage.local.get("labConfig");
      const storedBlocks = (lc && lc.blocks) ? lc.blocks.filter(b => b.enabled) : [];
      const storedPatterns = storedBlocks.map(b => (b.pattern || "").toLowerCase());

      if (chrome.declarativeNetRequest) {
        const activeRules = await chrome.declarativeNetRequest.getDynamicRules();
        const orphanIds = activeRules
          .filter(r => r.id >= 1000 && !storedPatterns.includes((r.condition?.urlFilter || "").toLowerCase()))
          .map(r => r.id);

        // Remove orphan rules (rules in DNR but not in storage)
        if (orphanIds.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: orphanIds });
        }

        labBlockedPatterns = storedPatterns;
      }
    } catch (e) {}

    // Map: which tool names are affected by which block patterns
    const TAG_BLOCK_MAP = {
      // Google
      "Google Tag Manager": ["googletagmanager.com/gtm.js", "googletagmanager.com"],
      "Google Analytics 4": ["google-analytics.com/g/collect", "google-analytics.com", "googletagmanager.com/gtag"],
      "Google Ads": ["googleads.g.doubleclick.net", "googlesyndication.com"],
      // Meta
      "Meta Pixel": ["connect.facebook.net"],
      // Ads
      "TikTok Pixel": ["analytics.tiktok.com"],
      "Pinterest Tag": ["s.pinimg.com/ct/core.js", "ct.pinterest.com"],
      "LinkedIn Insight": ["snap.licdn.com/li.lms-analytics"],
      "Microsoft Ads (Bing UET)": ["bat.bing.com/bat.js"],
      "X / Twitter Pixel": ["static.ads-twitter.com/uwt.js", "t.co/i/adsct"],
      "Snap Pixel": ["sc-static.net/scevent"],
      "Reddit Pixel": ["redditstatic.com/ads/pixel"],
      "Criteo": ["static.criteo.net"],
      "Outbrain": ["outbrain.com", "amplify.outbrain.com"],
      "Taboola": ["cdn.taboola.com"],
      // Analytics
      "Hotjar": ["static.hotjar.com", "script.hotjar.com"],
      "Microsoft Clarity": ["clarity.ms/tag"],
      "Adobe Analytics": ["omtrdc.net", "2o7.net"],
      "Adobe Launch / Tags": ["assets.adobedtm.com"],
      "Segment": ["cdn.segment.com/analytics.js"],
      "Amplitude": ["cdn.amplitude.com", "api.amplitude.com"],
      "Mixpanel": ["cdn.mxpnl.com", "api.mixpanel.com"],
      "Heap Analytics": ["cdn.heapanalytics.com", "heapanalytics.com"],
      "FullStory": ["edge.fullstory.com"],
      "Contentsquare": ["contentsquare.net"],
      "Mouseflow": ["cdn.mouseflow.com"],
      "Yandex Metrica": ["mc.yandex.ru/metrika"],
      "Matomo": ["matomo.js", "piwik.js"],
      "Optimizely": ["cdn.optimizely.com"],
      "VWO": ["dev.visualwebsiteoptimizer.com"],
      "AB Tasty": ["try.abtasty.com"],
      // Chatbots & tools
      "Intercom": ["widget.intercom.io", "api-iam.intercom.io"],
      "Zendesk Chat / Widget": ["static.zdassets.com", "v2.zopim.com"],
      "Drift": ["js.driftt.com", "js.drift.com"],
      "Crisp": ["client.crisp.chat"],
      "Tawk.to": ["embed.tawk.to"],
      "Tidio": ["code.tidio.co"],
      "LiveChat": ["cdn.livechatinc.com", "cdn.livechat-files.com"],
      "HubSpot": ["js.hs-scripts.com", "js.hsforms.net", "js.hs-analytics.net"],
      "Klaviyo": ["static.klaviyo.com"],
      "Tealium iQ": ["tags.tiqcdn.com"],
      "Datadog RUM": ["datadoghq-browser-agent.com"],
      "Sentry": ["browser.sentry-cdn.com"],
      "New Relic Browser": ["js-agent.newrelic.com"],
    };

    function isToolBlocked(toolName, ids) {
      const urlPatterns = TAG_BLOCK_MAP[toolName] || [];
      return labBlockedPatterns.some(bp => {
        // 1. Check if block pattern matches a known URL for this tool
        if (urlPatterns.some(tp => bp.includes(tp) || tp.includes(bp))) return true;
        // 2. Check if block pattern matches any of the detected IDs
        //    e.g. user blocked "GTM-N2VK78K" and this tool has that ID
        if (ids.some(id => bp.includes(id.toLowerCase()) || id.toLowerCase().includes(bp))) return true;
        return false;
      });
    }

    // Run detections
    const detected = [];
    const notDetected = [];
    for (const def of TAG_DEFINITIONS) {
      const ids = def.detect(ctx);
      if (ids.length > 0) {
        detected.push({ ...def, ids, blocked: isToolBlocked(def.name, ids) });
      } else {
        notDetected.push(def);
      }
    }

    if (detected.length === 0) {
      tagsResults.innerHTML = `<div class="dl-empty">No se detectaron herramientas de tracking</div>`;
      return;
    }

    // ID badge color class
    function idColorClass(id) {
      if (/^G-|^GT-/.test(id)) return "tags-id-ga4";
      if (/^GTM-/.test(id)) return "tags-id-gtm";
      if (/^AW-/.test(id)) return "tags-id-gads";
      if (/^\d{10,}$/.test(id)) return "tags-id-meta";
      return "tags-id-default";
    }

    // Summary bar
    const totalIds = detected.reduce((sum, d) => sum + d.ids.length, 0);
    const catIcons = {
      google: '<span class="tags-dot tags-dot-google"></span>',
      meta: '<span class="tags-dot tags-dot-meta"></span>',
      ads: '<span class="tags-dot tags-dot-ads"></span>',
      analytics: '<span class="tags-dot tags-dot-analytics"></span>',
      tools: '<span class="tags-dot tags-dot-tools"></span>',
      other: '<span class="tags-dot tags-dot-other"></span>',
    };
    const categories = {
      google: "Google",
      meta: "Meta",
      ads: "Publicidad",
      analytics: "Analítica & UX",
      tools: "Herramientas",
      other: "Otros",
    };
    let html = "";

    html += `<div class="tags-summary">`;
    html += `<span class="tags-summary-badge"><span class="tags-summary-num">${detected.length}</span> herramientas</span>`;
    html += `<span class="tags-summary-badge"><span class="tags-summary-num">${totalIds}</span> IDs</span>`;
    html += `</div>`;

    for (const [catKey, catLabel] of Object.entries(categories)) {
      const items = detected.filter((d) => d.category === catKey);
      if (items.length === 0) continue;

      const catTotalIds = items.reduce((sum, d) => sum + d.ids.length, 0);
      html += `<div class="tags-category">
        <div class="tags-category-header">
          <span class="tags-category-icon">${catIcons[catKey]}</span>
          <span class="tags-category-title">${catLabel}</span>
          <span class="tags-category-count">${items.length} herramienta${items.length > 1 ? "s" : ""} · ${catTotalIds} ID${catTotalIds > 1 ? "s" : ""}</span>
        </div>`;

      for (const item of items) {
        const blockPattern = (TAG_BLOCK_MAP[item.name] || [])[0] || "";
        html += `<div class="tags-item ${item.blocked ? "tags-item-blocked" : ""}" data-cat="${catKey}">
          <div class="tags-item-header">
            <div class="tags-item-icon">${item.icon}</div>
            <div class="tags-item-info">
              <span class="tags-item-name">${escapeHtml(item.name)}</span>
              <span class="tags-item-subtitle">${item.ids.length} ID${item.ids.length > 1 ? "s" : ""} detectado${item.ids.length > 1 ? "s" : ""}</span>
            </div>
            ${blockPattern ? `<div class="tags-block-wrap">
              <span class="tags-block-label">Bloquear</span>
              <label class="lab-switch tags-block-switch" title="${item.blocked ? "Desbloquear" : "Bloquear"}">
                <input type="checkbox" ${item.blocked ? "checked" : ""} data-block-pattern="${escapeHtml(blockPattern)}" data-tool-name="${escapeHtml(item.name)}">
                <span class="lab-switch-slider"></span>
              </label>
            </div>` : ""}
          </div>
          <div class="tags-item-ids">
            ${item.ids.map((id) => `<span class="tags-id ${idColorClass(id)}">${escapeHtml(id)}</span>`).join("")}
          </div>
        </div>`;
      }

      html += `</div>`;
    }

    // Not detected
    const googleMissing = notDetected.filter((d) => d.category === "google");
    if (googleMissing.length > 0) {
      html += `<div class="tags-not-detected">
        <div class="tags-category-header">
          <span class="tags-category-icon"><span class="tags-dot tags-dot-other"></span></span>
          <span class="tags-category-title">No detectados</span>
        </div>
        ${googleMissing.map((d) => `<span class="tags-missing">${d.icon} ${escapeHtml(d.name)}</span>`).join("")}
      </div>`;
    }

    tagsResults.innerHTML = html;

    // Load lab blocks from storage
    try {
      const { labConfig: lc } = await chrome.storage.local.get("labConfig");
      if (lc) {
        labBlocks = lc.blocks || [];
        labNextRuleId = lc.nextRuleId || 1000;
      }
    } catch (e) {}

    // Delegated handler for block toggles
    tagsResults.addEventListener("change", async function tagBlockHandler(e) {
      const cb = e.target;
      if (!cb.closest || !cb.closest(".tags-block-switch")) return;

      const pattern = cb.dataset.blockPattern;
      if (!pattern) return;

      if (cb.checked) {
        // Add block
        if (!labBlocks.some(b => b.pattern === pattern)) {
          const id = labNextRuleId++;
          labBlocks.push({ id, pattern, enabled: true });
        }
      } else {
        // Remove block
        labBlocks = labBlocks.filter(b => b.pattern !== pattern);
      }

      // Save blocks to storage
      try {
        const { labConfig: cur } = await chrome.storage.local.get("labConfig");
        const config = cur || {};
        config.blocks = labBlocks;
        config.nextRuleId = labNextRuleId;
        await chrome.storage.local.set({ labConfig: config });
        await labApplyBlockRules();
      } catch (err) {
        console.error("[Tags] Error saving block:", err);
      }

      // Update visual state
      const tagItem = cb.closest(".tags-item");
      if (tagItem) {
        tagItem.classList.toggle("tags-item-blocked", cb.checked);
      }

      // Show reload banner
      showTagsReloadBanner();
    });

  } catch (err) {
    tagsResults.innerHTML = `<div class="dl-empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function showTagsReloadBanner() {
  // Remove existing banner if any
  const existing = document.getElementById("tagsReloadBanner");
  if (existing) return; // already showing

  const banner = document.createElement("div");
  banner.id = "tagsReloadBanner";
  banner.className = "tags-reload-banner";
  banner.innerHTML = `
    <span>Recarga la página para aplicar los cambios</span>
    <button class="tags-reload-btn" id="tagsReloadBtn"><svg class="icon icon-sm"><use href="#i-refresh"/></svg><span>Recargar página</span></button>
  `;

  // Insert before tagsResults
  tagsResults.parentElement.insertBefore(banner, tagsResults);

  document.getElementById("tagsReloadBtn").addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    if (tabId) {
      await chrome.tabs.reload(tabId);
      banner.remove();
      // Re-scan after a short delay for the page to load
      setTimeout(() => runTagScan(), 1500);
    }
  });
}

tagsScanBtn.addEventListener("click", runTagScan);

// =============================================
// HTML GRABBER — copiar / descargar el HTML de la página
// =============================================

const htmlCaptureBtn = document.getElementById("htmlCaptureBtn");
const htmlUrl = document.getElementById("htmlUrl");
const htmlInfo = document.getElementById("htmlInfo");
const htmlSize = document.getElementById("htmlSize");
const htmlCopyBtn = document.getElementById("htmlCopyBtn");
const htmlDownloadBtn = document.getElementById("htmlDownloadBtn");
const htmlPreview = document.getElementById("htmlPreview");
const htmlEmpty = document.getElementById("htmlEmpty");
const htmlStatus = document.getElementById("htmlStatus");

let capturedHtml = "";
let capturedHostname = "";

function showHtmlStatus(text, type) {
  if (!htmlStatus) return;
  htmlStatus.textContent = text;
  htmlStatus.className = "html-status " + (type || "");
  htmlStatus.classList.remove("hidden");
  setTimeout(() => htmlStatus.classList.add("hidden"), 3000);
}

async function captureHtml() {
  if (!await ensureHostPermissions()) {
    showHtmlStatus("Se necesitan permisos de acceso a la página", "error");
    return;
  }

  const tabId = await getActiveTabId();
  if (!tabId) { showHtmlStatus("No se pudo acceder a la pestaña", "error"); return; }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.startsWith("http")) {
      showHtmlStatus("Esta pestaña no es una página web", "error");
      return;
    }
    capturedHostname = new URL(tab.url).hostname;
    htmlUrl.textContent = capturedHostname;

    // Grab the live, rendered DOM (incluye cambios hechos por JS)
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const dt = document.doctype;
        const doctype = dt
          ? "<!DOCTYPE " + dt.name +
            (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : "") +
            (dt.systemId ? ' "' + dt.systemId + '"' : "") + ">\n"
          : "";
        return doctype + document.documentElement.outerHTML;
      },
    });

    capturedHtml = (res && res.result) || "";
    if (!capturedHtml) { showHtmlStatus("No se pudo leer el HTML", "error"); return; }

    const bytes = new Blob([capturedHtml]).size;
    const sizeLabel = bytes > 1024 ? (bytes / 1024).toFixed(1) + " KB" : bytes + " B";
    htmlSize.textContent = sizeLabel + " · " + capturedHtml.length.toLocaleString("es-ES") + " caracteres";
    htmlPreview.value = capturedHtml;

    htmlInfo.classList.remove("hidden");
    htmlPreview.classList.remove("hidden");
    htmlEmpty.classList.add("hidden");
    showHtmlStatus("HTML capturado", "success");
  } catch (e) {
    showHtmlStatus("Error: " + e.message, "error");
  }
}

async function copyHtml() {
  if (!capturedHtml) { showHtmlStatus("Primero captura el HTML", "error"); return; }
  try {
    await navigator.clipboard.writeText(capturedHtml);
    showHtmlStatus("HTML copiado al portapapeles", "success");
  } catch (e) {
    showHtmlStatus("No se pudo copiar al portapapeles", "error");
  }
}

function downloadHtml() {
  if (!capturedHtml) { showHtmlStatus("Primero captura el HTML", "error"); return; }
  const blob = new Blob([capturedHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (capturedHostname || "pagina") + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showHtmlStatus("Descarga iniciada", "success");
}

if (htmlCaptureBtn) htmlCaptureBtn.addEventListener("click", captureHtml);
if (htmlCopyBtn) htmlCopyBtn.addEventListener("click", copyHtml);
if (htmlDownloadBtn) htmlDownloadBtn.addEventListener("click", downloadHtml);

// =============================================
// CONSOLE CAPTURE — capturar logs de la consola
// =============================================

const CONSOLE_CS_ID = "console-capture-cs";
const CONSOLE_STORAGE_KEY = "__ac_console_logs";

const conToggleBtn = document.getElementById("conToggleBtn");
const conRefreshBtn = document.getElementById("conRefreshBtn");
const conMeta = document.getElementById("conMeta");
const conCount = document.getElementById("conCount");
const conCopyBtn = document.getElementById("conCopyBtn");
const conDownloadBtn = document.getElementById("conDownloadBtn");
const conClearBtn = document.getElementById("conClearBtn");
const conPreview = document.getElementById("conPreview");
const conEmpty = document.getElementById("conEmpty");
const conStatus = document.getElementById("conStatus");

let consoleLogsText = "";
let consoleHostname = "";

function showConsoleStatus(text, type) {
  if (!conStatus) return;
  conStatus.textContent = text;
  conStatus.className = "con-status " + (type || "");
  conStatus.classList.remove("hidden");
  setTimeout(() => conStatus.classList.add("hidden"), 3000);
}

function setConsoleToggleUI(capturing) {
  if (!conToggleBtn) return;
  if (capturing) {
    conToggleBtn.innerHTML = '<svg class="icon"><use href="#i-stop"/></svg><span>Detener captura</span>';
    conToggleBtn.classList.add("con-capturing");
  } else {
    conToggleBtn.innerHTML = '<svg class="icon"><use href="#i-play"/></svg><span>Iniciar captura</span>';
    conToggleBtn.classList.remove("con-capturing");
  }
}

// La registración del content script es la fuente de verdad de si capturamos.
async function consoleIsCapturing() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [CONSOLE_CS_ID] });
    return scripts.length > 0;
  } catch (e) {
    return false;
  }
}

// Called when the Console tab opens — sync button state and load any logs.
async function consoleOnOpen() {
  const capturing = await consoleIsCapturing();
  setConsoleToggleUI(capturing);
  await refreshConsoleLogs(true);
}

async function toggleConsoleCapture() {
  const capturing = await consoleIsCapturing();
  if (capturing) {
    await stopConsoleCapture();
  } else {
    await startConsoleCapture();
  }
}

async function startConsoleCapture() {
  if (!await ensureHostPermissions()) {
    showConsoleStatus("Se necesitan permisos de acceso a la página", "error");
    return;
  }
  try {
    // Re-register cleanly in case a stale registration exists
    await chrome.scripting.unregisterContentScripts({ ids: [CONSOLE_CS_ID] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: CONSOLE_CS_ID,
      matches: ["http://*/*", "https://*/*"],
      js: ["content/console-capture-cs.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
    }]);

    // Inject NOW into the active tab too, so captura empieza sin esperar recarga.
    const tabId = await getActiveTabId();
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/console-capture-cs.js"],
        world: "MAIN",
      }).catch(() => {});
    }

    setConsoleToggleUI(true);
    getActiveTabId().then((tid) => { if (tid) chrome.runtime.sendMessage({ type: "widget-refresh", tabId: tid }).catch(() => {}); });
    showConsoleStatus("Captura activa — recarga la página para capturarla desde el inicio", "success");
  } catch (e) {
    showConsoleStatus("Error: " + e.message, "error");
  }
}

async function stopConsoleCapture() {
  await chrome.scripting.unregisterContentScripts({ ids: [CONSOLE_CS_ID] }).catch(() => {});
  setConsoleToggleUI(false);
  getActiveTabId().then((tid) => { if (tid) chrome.runtime.sendMessage({ type: "widget-refresh", tabId: tid }).catch(() => {}); });
  showConsoleStatus("Captura detenida", "success");
}

const CONSOLE_LEVEL_LABEL = { log: "LOG", info: "INFO", warn: "WARN", error: "ERROR", debug: "DEBUG" };

// Read the captured logs from the page's sessionStorage and render them.
async function refreshConsoleLogs(silent) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    if (!silent) showConsoleStatus("No se pudo acceder a la pestaña", "error");
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.startsWith("http")) {
      if (!silent) showConsoleStatus("Esta pestaña no es una página web", "error");
      return;
    }
    consoleHostname = new URL(tab.url).hostname;

    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CONSOLE_STORAGE_KEY],
      func: (key) => {
        try { return sessionStorage.getItem(key) || "[]"; }
        catch (e) { return "[]"; }
      },
    });

    let logs = [];
    try { logs = JSON.parse((res && res.result) || "[]"); } catch (e) { logs = []; }
    if (!Array.isArray(logs)) logs = [];

    renderConsoleLogs(logs);
  } catch (e) {
    if (!silent) showConsoleStatus("Error: " + e.message, "error");
  }
}

function renderConsoleLogs(logs) {
  if (!logs.length) {
    consoleLogsText = "";
    conPreview.value = "";
    conPreview.classList.add("hidden");
    conMeta.classList.add("hidden");
    conEmpty.classList.remove("hidden");
    return;
  }

  const lines = logs.map((e) => {
    const t = new Date(e.ts || Date.now()).toLocaleTimeString("es-ES", { hour12: false });
    const lvl = CONSOLE_LEVEL_LABEL[e.level] || (e.level || "LOG").toUpperCase();
    return "[" + t + "] [" + lvl + "] " + (e.text || "");
  });

  consoleLogsText = lines.join("\n");
  conPreview.value = consoleLogsText;
  conCount.textContent = logs.length + (logs.length === 1 ? " mensaje" : " mensajes");

  conPreview.classList.remove("hidden");
  conMeta.classList.remove("hidden");
  conEmpty.classList.add("hidden");
}

async function copyConsole() {
  if (!consoleLogsText) { showConsoleStatus("No hay logs capturados", "error"); return; }
  try {
    await navigator.clipboard.writeText(consoleLogsText);
    showConsoleStatus("Logs copiados al portapapeles", "success");
  } catch (e) {
    showConsoleStatus("No se pudo copiar al portapapeles", "error");
  }
}

function downloadConsole() {
  if (!consoleLogsText) { showConsoleStatus("No hay logs capturados", "error"); return; }
  const blob = new Blob([consoleLogsText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "consola-" + (consoleHostname || "pagina") + ".txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showConsoleStatus("Descarga iniciada", "success");
}

async function clearConsole() {
  const tabId = await getActiveTabId();
  if (!tabId) { showConsoleStatus("No se pudo acceder a la pestaña", "error"); return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CONSOLE_STORAGE_KEY],
      func: (key) => {
        try { sessionStorage.removeItem(key); } catch (e) {}
      },
    });
    renderConsoleLogs([]);
    showConsoleStatus("Logs limpiados", "success");
  } catch (e) {
    showConsoleStatus("Error: " + e.message, "error");
  }
}

if (conToggleBtn) conToggleBtn.addEventListener("click", toggleConsoleCapture);
if (conRefreshBtn) conRefreshBtn.addEventListener("click", () => refreshConsoleLogs(false));
if (conCopyBtn) conCopyBtn.addEventListener("click", copyConsole);
if (conDownloadBtn) conDownloadBtn.addEventListener("click", downloadConsole);
if (conClearBtn) conClearBtn.addEventListener("click", clearConsole);


// =============================================
// EVENTOS GA4 — Generador de dataLayer.push
// =============================================
// Esquemas declarativos (mismo patrón que CONSENT_AUDIT_RULES): para añadir un
// evento nuevo basta con añadir un objeto a DL_EVENT_SCHEMAS. Basado en la
// guía oficial de ecommerce de GA4/GTM (developers.google.com/analytics): funnel completo, parámetros
// requeridos por evento y el convenio de limpiar con { ecommerce: null }.

const DL_DOCS_BASE = "https://developers.google.com/analytics/devguides/collection/ga4/reference/events?hl=es#";

const DL_ITEM_FIELDS = [
  { key: "item_id", required: true, example: "SKU_123" },
  { key: "item_name", required: true, example: "Camiseta básica" },
  { key: "price", type: "number", example: 19.99 },
  { key: "quantity", type: "number", example: 1 },
  { key: "item_brand", example: "MiMarca" },
  { key: "item_category", example: "Ropa" },
  { key: "item_variant", example: "Talla M" },
  { key: "discount", type: "number", example: 0 },
];

const DL_EVENT_SCHEMAS = [
  // --- Funnel ecommerce (GA4 estándar) ---
  { id: "view_item_list", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "item_list_id", example: "related_products" },
      { key: "item_list_name", example: "Productos relacionados" },
    ] },
  { id: "select_item", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "item_list_id", example: "related_products" },
      { key: "item_list_name", example: "Productos relacionados" },
    ] },
  { id: "view_item", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 19.99 },
    ] },
  { id: "add_to_cart", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 19.99 },
    ] },
  { id: "remove_from_cart", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 19.99 },
    ] },
  { id: "view_cart", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 39.98 },
    ] },
  { id: "begin_checkout", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 39.98 },
      { key: "coupon", example: "VERANO10" },
    ] },
  { id: "add_shipping_info", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 39.98 },
      { key: "coupon", example: "VERANO10" },
      { key: "shipping_tier", example: "Estándar" },
    ] },
  { id: "add_payment_info", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 39.98 },
      { key: "coupon", example: "VERANO10" },
      { key: "payment_type", example: "Tarjeta" },
    ] },
  { id: "purchase", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "transaction_id", required: true, example: "T_10001" },
      { key: "currency", required: true, example: "EUR" },
      { key: "value", required: true, type: "number", example: 44.97 },
      { key: "tax", type: "number", example: 7.80 },
      { key: "shipping", type: "number", example: 4.99 },
      { key: "coupon", example: "VERANO10" },
    ] },
  { id: "refund", group: "Funnel ecommerce", ecommerce: true, items: true,
    fields: [
      { key: "transaction_id", required: true, example: "T_10001" },
      { key: "currency", example: "EUR" },
      { key: "value", type: "number", example: 44.97 },
    ] },
  // --- Otros eventos recomendados ---
  { id: "generate_lead", group: "Otros eventos", ecommerce: false,
    fields: [
      { key: "currency", example: "EUR" },
      { key: "value", type: "number", example: 99 },
    ] },
  { id: "login", group: "Otros eventos", ecommerce: false,
    fields: [ { key: "method", example: "Google" } ] },
  { id: "sign_up", group: "Otros eventos", ecommerce: false,
    fields: [ { key: "method", example: "Email" } ] },
  { id: "search", group: "Otros eventos", ecommerce: false,
    fields: [ { key: "search_term", required: true, example: "zapatillas running" } ] },
  { id: "evento_custom", group: "Otros eventos", ecommerce: false, custom: true,
    docs: "https://support.google.com/analytics/answer/12229021?hl=es",
    fields: [ { key: "event", label: "Nombre del evento", required: true, example: "mi_evento" } ] },
];

const evSelect = document.getElementById("evSelect");
const evDocsLink = document.getElementById("evDocsLink");
const evFieldsEl = document.getElementById("evFields");
const evItemBlock = document.getElementById("evItemBlock");
const evItemFieldsEl = document.getElementById("evItemFields");
const evSnippet = document.getElementById("evSnippet");
const evCopyBtn = document.getElementById("evCopyBtn");
const evPushBtn = document.getElementById("evPushBtn");
const evResetBtn = document.getElementById("evResetBtn");
const evStatusEl = document.getElementById("evStatus");

let evInitialized = false;

function showEvStatus(text, type) {
  if (!evStatusEl) return;
  evStatusEl.textContent = text;
  evStatusEl.className = "ev-status " + (type || "");
  evStatusEl.classList.remove("hidden");
  setTimeout(() => evStatusEl.classList.add("hidden"), 3000);
}

function evCurrentSchema() {
  return DL_EVENT_SCHEMAS.find((s) => s.id === evSelect.value) || null;
}

function evFieldInput(prefix, f) {
  const wrap = document.createElement("label");
  wrap.className = "ev-field";
  const name = document.createElement("span");
  name.className = "ev-field-label";
  name.textContent = (f.label || f.key) + (f.required ? " *" : "");
  const input = document.createElement("input");
  input.type = "text";
  input.id = prefix + f.key;
  input.placeholder = String(f.example);
  input.addEventListener("input", evGenerate);
  wrap.appendChild(name);
  wrap.appendChild(input);
  return wrap;
}

function evRenderFields() {
  const sch = evCurrentSchema();
  if (!sch) return;
  evFieldsEl.innerHTML = "";
  sch.fields.forEach((f) => evFieldsEl.appendChild(evFieldInput("evf_", f)));

  const wantsItems = !!(sch.ecommerce && sch.items);
  evItemBlock.classList.toggle("hidden", !wantsItems);
  if (wantsItems) {
    evItemFieldsEl.innerHTML = "";
    DL_ITEM_FIELDS.forEach((f) => evItemFieldsEl.appendChild(evFieldInput("evi_", f)));
  }

  evDocsLink.href = sch.docs || (DL_DOCS_BASE + sch.id);
  evGenerate();
}

// Lee un campo: vacío → example si es requerido, null si es opcional.
function evReadField(id, f) {
  const el = document.getElementById(id);
  const raw = el ? el.value.trim() : "";
  if (raw === "") return f.required ? f.example : null;
  if (f.type === "number") {
    const n = Number(raw.replace(",", "."));
    return isNaN(n) ? raw : n;
  }
  return raw;
}

// Serializador: objeto JS con claves sin comillas (formato snippet legible)
function evLiteral(v) {
  if (typeof v === "number") return String(v);
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function evObjToCode(obj, depth) {
  const pad = "  ".repeat(depth + 1);
  const end = "  ".repeat(depth);
  const parts = Object.keys(obj).map((k) => {
    const v = obj[k];
    let out;
    if (Array.isArray(v)) {
      out = "[\n" + v.map((x) => pad + "  " + evObjToCode(x, depth + 2)).join(",\n") + "\n" + pad + "]";
    } else if (v !== null && typeof v === "object") {
      out = evObjToCode(v, depth + 1);
    } else {
      out = evLiteral(v);
    }
    return pad + k + ": " + out;
  });
  return "{\n" + parts.join(",\n") + "\n" + end + "}";
}

// Construye el objeto del evento desde el formulario (fuente única para
// snippet y push — el push NUNCA evalúa texto).
function evBuildObject() {
  const sch = evCurrentSchema();
  if (!sch) return null;

  const data = {};
  sch.fields.forEach((f) => {
    const v = evReadField("evf_" + f.key, f);
    if (v !== null) data[f.key] = v;
  });

  const eventName = sch.custom ? (data.event || "mi_evento") : sch.id;
  if (sch.custom) delete data.event;

  let obj;
  if (sch.ecommerce) {
    const eco = Object.assign({}, data);
    if (sch.items) {
      const item = {};
      DL_ITEM_FIELDS.forEach((f) => {
        const v = evReadField("evi_" + f.key, f);
        if (v !== null) item[f.key] = v;
      });
      eco.items = [item];
    }
    obj = Object.assign({ event: eventName }, { ecommerce: eco });
  } else {
    obj = Object.assign({ event: eventName }, data);
  }
  return { obj: obj, ecommerce: !!sch.ecommerce };
}

function evGenerate() {
  const built = evBuildObject();
  if (!built) return;
  const sch = { ecommerce: built.ecommerce };
  const obj = built.obj;

  let code = "window.dataLayer = window.dataLayer || [];\n\n";
  if (sch.ecommerce) {
    code += "// Limpia el objeto ecommerce del push anterior (recomendado por Google)\n";
    code += "dataLayer.push({ ecommerce: null });\n\n";
  }
  code += "dataLayer.push(" + evObjToCode(obj, 0) + ");";
  evSnippet.value = code;
}

function evEnsureInit() {
  if (evInitialized) return;
  evInitialized = true;

  // Select agrupado por categoría
  const groups = {};
  DL_EVENT_SCHEMAS.forEach((s) => {
    (groups[s.group] = groups[s.group] || []).push(s);
  });
  Object.keys(groups).forEach((g) => {
    const og = document.createElement("optgroup");
    og.label = g;
    groups[g].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.custom ? "Evento personalizado" : s.id;
      og.appendChild(opt);
    });
    evSelect.appendChild(og);
  });

  evSelect.addEventListener("change", evRenderFields);
  evRenderFields();
}

async function evPushToPage() {
  // Empuja el OBJETO construido desde el formulario — dato estructurado,
  // sin evaluación de código (cumple la política de la Web Store).
  const built = evBuildObject();
  if (!built) return;
  if (!await ensureHostPermissions()) {
    showEvStatus("Se necesitan permisos de acceso a la página", "error");
    return;
  }
  const tabId = await getActiveTabId();
  if (!tabId) { showEvStatus("No se pudo acceder a la pestaña", "error"); return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload) => {
        window.dataLayer = window.dataLayer || [];
        if (payload.ecommerce) window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push(payload.obj);
        console.log("%c[Eventos GA4]%c dataLayer.push \u2192",
          "background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold", "color:#60a5fa", payload.obj);
      },
      args: [built],
      world: "MAIN",
    });
    showEvStatus("Push ejecutado (valores del formulario)", "success");
  } catch (e) {
    showEvStatus("Error: " + e.message, "error");
  }
}

if (evCopyBtn) evCopyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(evSnippet.value);
    showEvStatus("Snippet copiado al portapapeles", "success");
  } catch (e) {
    showEvStatus("No se pudo copiar", "error");
  }
});
if (evPushBtn) evPushBtn.addEventListener("click", evPushToPage);
if (evResetBtn) evResetBtn.addEventListener("click", () => {
  document.querySelectorAll("#tabEvents input").forEach((i) => { i.value = ""; });
  evGenerate();
  showEvStatus("Campos limpiados", "success");
});

// =============================================
// TIME TRAVEL
// =============================================

const ttToggle = document.getElementById("ttToggle");
const ttDateInput = document.getElementById("ttDate");
const ttTimeInput = document.getElementById("ttTime");
const ttStatus = document.getElementById("ttStatus");
const ttCurrentTime = document.getElementById("ttCurrentTime");
const ttNowBtn = document.getElementById("ttNowBtn");
let ttActive = false;
let ttTimerInterval = null;

// Format date for input[type=date]
function toDateStr(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function toTimeStr(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Initialize date/time inputs with current time
function initTimeTravelInputs() {
  const now = new Date();
  ttDateInput.value = toDateStr(now);
  ttTimeInput.value = toTimeStr(now);
}

// Load saved time travel state
async function loadTimeTravelState() {
  try {
    const data = await chrome.storage.local.get(["timeTravelEnabled", "timeTravelTarget"]);
    if (data.timeTravelEnabled && data.timeTravelTarget) {
      ttActive = true;
      const target = new Date(data.timeTravelTarget);
      ttDateInput.value = toDateStr(target);
      ttTimeInput.value = toTimeStr(target);
      ttToggle.innerHTML = '<svg class="icon"><use href="#i-stop"/></svg><span>Desactivar</span>';
      ttToggle.classList.add("btn-stop");
      ttStatus.textContent = "Viajando en el tiempo";
      ttStatus.className = "tt-badge tt-badge-active";
      startFakeClock(data.timeTravelTarget);
    } else {
      ttActive = false;
      ttToggle.innerHTML = '<svg class="icon"><use href="#i-fast-forward"/></svg><span>Activar Time Travel</span>';
      ttToggle.classList.remove("btn-stop");
      ttStatus.textContent = "Inactivo";
      ttStatus.className = "tt-badge tt-badge-idle";
      ttCurrentTime.textContent = "";
      stopFakeClock();
    }
  } catch { /* ignore */ }
}

// Show the simulated "current time" ticking
function startFakeClock(targetTimestamp) {
  stopFakeClock();
  const offset = targetTimestamp - Date.now();
  function tick() {
    const fakeNow = new Date(Date.now() + offset);
    ttCurrentTime.textContent = fakeNow.toLocaleString("es-ES", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }
  tick();
  ttTimerInterval = setInterval(tick, 1000);
}

function stopFakeClock() {
  if (ttTimerInterval) {
    clearInterval(ttTimerInterval);
    ttTimerInterval = null;
  }
}

// Activate time travel
async function activateTimeTravel() {
  if (!await ensureHostPermissions()) {
    showStatus("Se necesitan permisos de acceso a páginas web", "error");
    return;
  }

  const dateVal = ttDateInput.value;
  const timeVal = ttTimeInput.value || "12:00";
  if (!dateVal) {
    showStatus("Selecciona una fecha", "error");
    return;
  }

  const target = new Date(`${dateVal}T${timeVal}:00`);
  if (isNaN(target.getTime())) {
    showStatus("Fecha/hora inválida", "error");
    return;
  }

  const targetTimestamp = target.getTime();

  // Save to storage (background reads this)
  await chrome.storage.local.set({
    timeTravelEnabled: true,
    timeTravelTarget: targetTimestamp,
  });

  ttActive = true;
  getActiveTabId().then((tid) => { if (tid) chrome.runtime.sendMessage({ type: "widget-refresh", tabId: tid }).catch(() => {}); });
  ttToggle.textContent = "⏹ Desactivar";
  ttToggle.classList.add("btn-stop");
  ttStatus.textContent = "Viajando en el tiempo";
  ttStatus.className = "tt-badge tt-badge-active";
  startFakeClock(targetTimestamp);

  // Refresh the active tab to apply
  const tabId = await getActiveTabId();
  if (tabId) {
    chrome.tabs.reload(tabId);
  }
}

// Deactivate time travel
async function deactivateTimeTravel() {
  await chrome.storage.local.set({
    timeTravelEnabled: false,
    timeTravelTarget: null,
  });

  ttActive = false;
  getActiveTabId().then((tid) => { if (tid) chrome.runtime.sendMessage({ type: "widget-refresh", tabId: tid }).catch(() => {}); });
  ttToggle.textContent = "⏩ Activar Time Travel";
  ttToggle.classList.remove("btn-stop");
  ttStatus.textContent = "Inactivo";
  ttStatus.className = "tt-badge tt-badge-idle";
  ttCurrentTime.textContent = "";
  stopFakeClock();

  // Remove home warning if present
  const ttHomeWarning = document.getElementById("homeTtWarning");
  if (ttHomeWarning) ttHomeWarning.remove();

  // Refresh the active tab to remove override
  const tabId = await getActiveTabId();
  if (tabId) {
    chrome.tabs.reload(tabId);
  }
}

// Get current tab
async function getActiveTabId() {
  if (IS_PANEL && chrome.devtools?.inspectedWindow?.tabId) {
    return chrome.devtools.inspectedWindow.tabId;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

// Toggle button
ttToggle.addEventListener("click", () => {
  if (ttActive) {
    deactivateTimeTravel();
  } else {
    activateTimeTravel();
  }
});

// "Now" button — reset to current real time
ttNowBtn.addEventListener("click", () => {
  const now = new Date();
  ttDateInput.value = toDateStr(now);
  ttTimeInput.value = toTimeStr(now);
});

// Info popover toggle
const ttInfoBtn = document.getElementById("ttInfoBtn");
const ttInfoPopover = document.getElementById("ttInfoPopover");
if (ttInfoBtn && ttInfoPopover) {
  ttInfoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = ttInfoPopover.classList.toggle("hidden");
    ttInfoBtn.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", (e) => {
    if (ttInfoPopover.classList.contains("hidden")) return;
    if (ttInfoPopover.contains(e.target) || ttInfoBtn.contains(e.target)) return;
    ttInfoPopover.classList.add("hidden");
    ttInfoBtn.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ttInfoPopover.classList.contains("hidden")) {
      ttInfoPopover.classList.add("hidden");
      ttInfoBtn.setAttribute("aria-expanded", "false");
    }
  });
}

// Init
initTimeTravelInputs();
loadTimeTravelState();

// =============================================
// CACHE
// =============================================

const cacheClearBtn = document.getElementById("cacheClearBtn");
const cacheStatusEl = document.getElementById("cacheStatus");
const cacheSiteBadge = document.getElementById("cacheSiteBadge");

function showCacheStatus(text, type) {
  cacheStatusEl.textContent = text;
  cacheStatusEl.className = "cache-status cache-status-" + type;
  cacheStatusEl.classList.remove("hidden");
  setTimeout(() => cacheStatusEl.classList.add("hidden"), 3000);
}

// Show current site hostname in the badge
async function updateCacheSiteBadge() {
  try {
    const tabId = await getActiveTabId();
    if (!tabId) return;
    const t = await chrome.tabs.get(tabId);
    const url = t?.url;
    if (url) {
      const host = new URL(url).hostname;
      cacheSiteBadge.textContent = host;
    }
  } catch (e) {}
}

// Clear site data (only current site) and reload, optionally adding refreshCache=now
async function clearSiteData() {
  if (!await ensureHostPermissions()) {
    showCacheStatus("Se necesitan permisos de acceso a la página", "error");
    return;
  }

  const doCookies = document.getElementById("cacheClearCookies").checked;
  const doStorage = document.getElementById("cacheClearStorage").checked;
  const doCache = document.getElementById("cacheClearCache").checked;
  const doSW = document.getElementById("cacheClearServiceWorkers").checked;

  if (!doCookies && !doStorage && !doCache && !doSW) {
    showCacheStatus("Selecciona al menos una opción", "error");
    return;
  }

  try {
    const tabId = await getActiveTabId();
    if (!tabId) { showCacheStatus("No se pudo obtener la pestaña", "error"); return; }

    const t = await chrome.tabs.get(tabId);
    const url = t?.url;
    if (!url) { showCacheStatus("No se pudo obtener la URL", "error"); return; }

    const origin = new URL(url).origin;

    // Run all clears in parallel — sequential awaits made the reload feel laggy.
    const tasks = [];

    // In-page clear: document.cookie + localStorage/sessionStorage
    if (doCookies || doStorage) {
      tasks.push(chrome.scripting.executeScript({
        target: { tabId },
        func: (clearCookies, clearStorage) => {
          if (clearStorage) {
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}
          }
          if (clearCookies) {
            document.cookie.split(";").forEach((c) => {
              const name = c.split("=")[0].trim();
              if (!name) return;
              const paths = [location.pathname, "/"];
              const domains = [location.hostname, "." + location.hostname];
              paths.forEach((p) => {
                document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=" + p;
                domains.forEach((d) => {
                  document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=" + p + ";domain=" + d;
                });
              });
            });
          }
        },
        args: [doCookies, doStorage],
        world: "MAIN",
      }).catch(() => {}));
    }

    // browsingData scoped to origin (fast)
    const originScoped = {};
    if (doStorage) { originScoped.localStorage = true; originScoped.indexedDB = true; }
    if (doSW) { originScoped.serviceWorkers = true; originScoped.cacheStorage = true; }
    if (doCookies) { originScoped.cookies = true; }
    if (Object.keys(originScoped).length > 0) {
      tasks.push(chrome.browsingData.remove({ origins: [origin] }, originScoped).catch(() => {}));
    }

    // HTTP cache (no per-origin filter in the API). Limit to the last hour
    // so it's fast — large global cache clears can take 10-30s.
    if (doCache) {
      const sinceOneHour = Date.now() - 60 * 60 * 1000;
      tasks.push(chrome.browsingData.remove({ since: sinceOneHour }, { cache: true, cacheStorage: true }).catch(() => {}));
    }

    await Promise.all(tasks);
    chrome.tabs.reload(tabId, { bypassCache: true });

    const items = [];
    if (doCookies) items.push("cookies");
    if (doStorage) items.push("storage");
    if (doCache) items.push("cache");
    if (doSW) items.push("SW");
    showCacheStatus("Aplicado: " + items.join(", "), "success");
  } catch (e) {
    showCacheStatus("Error: " + e.message, "error");
  }
}

cacheClearBtn.addEventListener("click", clearSiteData);

// =============================================
// CONSENT MODE
// =============================================

const CONSENT_TYPES = [
  { key: "ad_storage", label: "ad_storage", gcd: true },
  { key: "analytics_storage", label: "analytics_storage", gcd: true },
  { key: "ad_user_data", label: "ad_user_data", gcd: true },
  { key: "ad_personalization", label: "ad_personalization", gcd: true },
  { key: "personalization_storage", label: "personalization_storage", gcd: false },
  { key: "functionality_storage", label: "functionality_storage", gcd: false },
  { key: "security_storage", label: "security_storage", gcd: false },
];

// GCD character meanings
const GCD_CHARS = {
  l: { label: "No configurado", cls: "muted" },
  p: { label: "Denegado (default, sin update)", cls: "denied" },
  q: { label: "Denegado \u2192 Denegado (sin cambio)", cls: "denied" },
  t: { label: "Permitido (default, sin update)", cls: "granted" },
  r: { label: "Denegado \u2192 Permitido (actualizado)", cls: "granted" },
  u: { label: "Permitido \u2192 Denegado (revocado)", cls: "denied" },
  v: { label: "Permitido \u2192 Permitido (confirmado)", cls: "granted" },
  m: { label: "Sin default \u2192 Denegado", cls: "denied" },
  n: { label: "Sin default \u2192 Permitido", cls: "granted" },
};

// GCS descriptions
const GCS_DESC = {
  G100: "ad_storage: denegado, analytics_storage: denegado",
  G101: "ad_storage: denegado, analytics_storage: permitido",
  G110: "ad_storage: permitido, analytics_storage: denegado",
  G111: "ad_storage: permitido, analytics_storage: permitido",
};

// Plain-language descriptions per signal
const CONSENT_SIGNAL_INFO = {
  ad_storage: "Cookies y almacenamiento para publicidad",
  analytics_storage: "Cookies y almacenamiento para analítica (GA4)",
  ad_user_data: "Envío de datos del usuario a Google Ads",
  ad_personalization: "Personalización de anuncios (remarketing)",
  personalization_storage: "Preferencias de personalización de contenido",
  functionality_storage: "Funcionalidad básica del sitio (idioma, vídeo…)",
  security_storage: "Seguridad (antifraude, autenticación)",
};

// ---- MAIN world: scan consent state ----
function scanConsentMode() {
  var TYPES = [
    "ad_storage", "analytics_storage", "ad_user_data",
    "ad_personalization", "personalization_storage",
    "functionality_storage", "security_storage",
  ];

  var result = {
    detected: false,
    signals: {},
    defaultConsent: {},
    updateConsent: {},
    gcsCode: null,
    gcdCode: null,
    gcdRaw: null,
    cmp: null,
    consentHistory: [],
    waitForUpdate: null,
    networkHits: [],
    urlPassthrough: null,
    adsDataRedaction: null,
    regions: [],
    v2: false,
  };

  // ¿Es un hit de Google que puede llevar estado de consentimiento?
  // Incluye google.com/pagead/1p-conversion (Safari/Firefox) y pagead2.googlesyndication.
  function isGoogleHit(str) {
    return /google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com/i.test(str) ||
           /\/(g|ccm)\/collect(\?|$)/.test(str) ||
           /^https?:\/\/(www\.)?google\.[a-z.]{2,6}\/pagead\//i.test(str);
  }

  // Clasificador de vendor para hits de Google
  function classifyVendor(host, path) {
    if (host.indexOf("google-analytics") !== -1 || host.indexOf("analytics.google") !== -1 || path.indexOf("/g/collect") !== -1) return "GA4";
    if (path.indexOf("/ccm/collect") !== -1) return "Ads CCM";
    if (host.indexOf("googleadservices") !== -1 || path.indexOf("/pagead/") !== -1) return "Google Ads";
    if (host.indexOf("fls.doubleclick") !== -1) return "Floodlight";
    if (host.indexOf("doubleclick") !== -1) return "DoubleClick";
    if (host.indexOf("googlesyndication") !== -1) return "AdSense";
    return "Google";
  }

  // 1. Read google_tag_data.ics (PRIMARY source — live consent state)
  try {
    var gtd = window.google_tag_data;
    if (gtd && gtd.ics) {
      result.detected = true;
      var ics = gtd.ics;
      var entries = ics.entries;

      if (entries) {
        // Handle Map, plain object, or any iterable
        var allKeys = [];
        if (typeof entries.forEach === "function") {
          // Map.forEach(value, key)
          entries.forEach(function (val, key) { allKeys.push(key); });
        } else if (typeof entries === "object") {
          allKeys = Object.keys(entries);
        }

        var getEntry = function (key) {
          if (typeof entries.get === "function") return entries.get(key);
          return entries[key];
        };

        // Read all known types + any extra keys from the map
        var allTypes = TYPES.slice();
        allKeys.forEach(function (k) {
          if (allTypes.indexOf(k) === -1) allTypes.push(k);
        });

        allTypes.forEach(function (type) {
          if (TYPES.indexOf(type) === -1) return; // only process known types
          var entry = getEntry(type);
          if (!entry) return;

          var defVal = null, updVal = null;

          // Try string first, then boolean
          if (typeof entry.default === "string") defVal = entry.default;
          else if (typeof entry.default === "boolean") defVal = entry.default ? "granted" : "denied";

          if (typeof entry.update === "string") updVal = entry.update;
          else if (typeof entry.update === "boolean") updVal = entry.update ? "granted" : "denied";

          // Also check 'declare' field (some CMPs use this)
          if (!defVal && !updVal && entry.declare) {
            if (typeof entry.declare === "string") defVal = entry.declare;
            else if (typeof entry.declare === "boolean") defVal = entry.declare ? "granted" : "denied";
          }

          result.signals[type] = {
            default: defVal,
            update: updVal,
            current: updVal || defVal || "not set",
            implicit: !!entry.implicit,
          };
        });
      }

      // Also try ics.hasLoaded or ics.cmpLoaded flags
      if (ics.wait_for_update) {
        result.waitForUpdate = ics.wait_for_update;
      }
    }
  } catch (e) {}

  // 2. Scan dataLayer for consent commands (for history + fill missing signals)
  try {
    var dl = window.dataLayer;
    if (dl && Array.isArray(dl)) {
      for (var i = 0; i < dl.length; i++) {
        var entry = dl[i];

        if (Array.isArray(entry) && entry[0] === "consent") {
          result.detected = true;
          var action = entry[1];
          var config = {};
          try { config = JSON.parse(JSON.stringify(entry[2] || {})); } catch (e2) {}

          if (action === "default") {
            Object.keys(config).forEach(function (k) {
              if (k !== "wait_for_update") result.defaultConsent[k] = config[k];
            });
            if (config.wait_for_update) result.waitForUpdate = config.wait_for_update;
            if (config.region && Array.isArray(config.region)) {
              config.region.forEach(function (r) {
                if (result.regions.indexOf(r) === -1) result.regions.push(r);
              });
            }
          } else if (action === "update") {
            Object.keys(config).forEach(function (k) {
              result.updateConsent[k] = config[k];
            });
          }

          result.consentHistory.push({ action: action, config: config, index: i });
        }

        // gtag('set', ...) — ads_data_redaction / url_passthrough
        if (Array.isArray(entry) && entry[0] === "set") {
          var setKey = entry[1], setVal = entry[2];
          if (typeof setKey === "string") {
            if (setKey === "ads_data_redaction") result.adsDataRedaction = !!setVal;
            if (setKey === "url_passthrough") result.urlPassthrough = !!setVal;
          } else if (setKey && typeof setKey === "object") {
            if ("ads_data_redaction" in setKey) result.adsDataRedaction = !!setKey.ads_data_redaction;
            if ("url_passthrough" in setKey) result.urlPassthrough = !!setKey.url_passthrough;
          }
        }

        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          if (entry.event === "gtm.init_consent" || entry.event === "consent_update" ||
              entry.event === "cookie_consent_update") {
            result.detected = true;
            var histConfig = {};
            try { histConfig = JSON.parse(JSON.stringify(entry)); } catch (e3) {}
            result.consentHistory.push({ action: entry.event, config: histConfig, index: i });
          }
        }
      }
    }
  } catch (e) {}

  // 3. Fill missing signals from dataLayer + enrich existing with dataLayer defaults
  TYPES.forEach(function (type) {
    var dlDef = result.defaultConsent[type] || null;
    var dlUpd = result.updateConsent[type] || null;

    if (!result.signals[type]) {
      // Not in ICS — use dataLayer data
      if (dlDef || dlUpd) {
        result.detected = true;
        result.signals[type] = {
          default: dlDef,
          update: dlUpd,
          current: dlUpd || dlDef || "not set",
          implicit: false,
        };
      }
    } else {
      // Already from ICS — fill in default from dataLayer if ICS didn't have it
      if (!result.signals[type].default && dlDef) {
        result.signals[type].default = dlDef;
      }
      if (!result.signals[type].update && dlUpd) {
        result.signals[type].update = dlUpd;
        result.signals[type].current = dlUpd;
      }
    }
  });

  // 4. Calculate GCS code from CURRENT state
  var adSig = result.signals.ad_storage;
  var anSig = result.signals.analytics_storage;
  if (adSig || anSig) {
    var adBit = (adSig && adSig.current === "granted") ? "1" : "0";
    var anBit = (anSig && anSig.current === "granted") ? "1" : "0";
    result.gcsCode = "G1" + adBit + anBit;
  }

  // 5. Calculate GCD code from signals
  var gcdTypes = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"];
  var gcdStr = "1";
  gcdTypes.forEach(function (type) {
    var sig = result.signals[type];
    var ch = "l";
    if (sig) {
      var d = sig.default;
      var u = sig.update;
      if (!d && !u) ch = "l";
      else if (d === "denied" && !u) ch = "p";
      else if (d === "granted" && !u) ch = "t";
      else if (d === "denied" && u === "denied") ch = "q";
      else if (d === "denied" && u === "granted") ch = "r";
      else if (d === "granted" && u === "denied") ch = "u";
      else if (d === "granted" && u === "granted") ch = "v";
      else if (!d && u === "denied") ch = "m";
      else if (!d && u === "granted") ch = "n";
    }
    gcdStr += "3" + ch;
  });
  gcdStr += "5";
  result.gcdCode = gcdStr;

  // 5b. Versión: v2 si existen las señales nuevas (ad_user_data / ad_personalization)
  result.v2 = !!(result.signals.ad_user_data || result.signals.ad_personalization);

  // 6. Detect CMP (Consent Management Platform)
  var cmps = [
    { name: "OneTrust", check: function () { return !!window.OneTrust || !!window.OptanonWrapper; } },
    { name: "Cookiebot", check: function () { return !!window.Cookiebot || !!window.CookieConsent; } },
    { name: "Didomi", check: function () { return !!window.Didomi || !!window.didomiOnReady; } },
    { name: "Usercentrics", check: function () { return !!window.UC_UI || !!window.usercentrics; } },
    { name: "CookieYes", check: function () { return !!window.getCkyConsent; } },
    { name: "Iubenda", check: function () { return !!window._iub; } },
    { name: "TrustArc", check: function () { return !!window.truste; } },
    { name: "Osano", check: function () { return !!window.Osano; } },
    { name: "Quantcast", check: function () { return !!window.__cmpapi || !!window.quantserve; } },
    { name: "Consentmanager", check: function () { return !!window.__cmp && typeof window.__cmp === "function"; } },
    { name: "CMP (TCF)", check: function () { return !!window.__tcfapi; } },
    { name: "Cookie Script", check: function () { return !!window.CookieScript; } },
    { name: "Complianz", check: function () { return !!window.complianz; } },
  ];

  for (var c = 0; c < cmps.length; c++) {
    try {
      if (cmps[c].check()) {
        result.cmp = cmps[c].name;
        break;
      }
    } catch (e) {}
  }

  // 7. Hits de Google con estado de consentimiento: interceptados en vivo +
  // performance entries (capturan hits disparados ANTES de inyectar el interceptor)
  try {
    var hits = (window.__AA_CONSENT_HITS || []).slice();
    var seenKeys = {};
    hits.forEach(function (h) {
      seenKeys[(h.en || "") + "|" + (h.gcs || "") + "|" + (h.vendor || "") + "|" + Math.round(h.timestamp / 2000)] = true;
    });
    var perf = performance.getEntriesByType("resource");
    for (var p = 0; p < perf.length; p++) {
      var pname = perf[p].name;
      if (!isGoogleHit(pname)) continue;
      try {
        var pu = new URL(pname);
        var pgcs = pu.searchParams.get("gcs");
        var pgcd = pu.searchParams.get("gcd");
        if (!pgcs && !pgcd) continue;
        var pts = Math.round((performance.timeOrigin || 0) + perf[p].startTime);
        var ven = classifyVendor(pu.hostname, pu.pathname);
        var pen = pu.searchParams.get("en");
        var key = (pen || "") + "|" + (pgcs || "") + "|" + ven + "|" + Math.round(pts / 2000);
        if (seenKeys[key]) continue;
        seenKeys[key] = true;
        hits.push({ gcs: pgcs, gcd: pgcd, timestamp: pts, vendor: ven, en: pen });
      } catch (e7) {}
    }
    hits.sort(function (a, b) { return a.timestamp - b.timestamp; });
    result.networkHits = hits.slice(-25);
    var last = hits[hits.length - 1];
    if (last && last.gcd) result.gcdRaw = last.gcd;
  } catch (e) {}

  return result;
}

// ---- MAIN world: intercept GA4 network requests to capture GCS/GCD ----
function consentNetworkInterceptor() {
  if (window.__AA_CONSENT_NET) return;
  window.__AA_CONSENT_NET = true;
  window.__AA_CONSENT_HITS = [];

  function classifyVendor(host, path) {
    if (host.indexOf("google-analytics") !== -1 || host.indexOf("analytics.google") !== -1 || path.indexOf("/g/collect") !== -1) return "GA4";
    if (path.indexOf("/ccm/collect") !== -1) return "Ads CCM";
    if (host.indexOf("googleadservices") !== -1 || path.indexOf("/pagead/") !== -1) return "Google Ads";
    if (host.indexOf("fls.doubleclick") !== -1) return "Floodlight";
    if (host.indexOf("doubleclick") !== -1) return "DoubleClick";
    if (host.indexOf("googlesyndication") !== -1) return "AdSense";
    return "Google";
  }

  function isGoogleHit(str) {
    return /google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com/i.test(str) ||
           /\/(g|ccm)\/collect(\?|$)/.test(str) ||
           /^https?:\/\/(www\.)?google\.[a-z.]{2,6}\/pagead\//i.test(str);
  }

  function extractParams(url) {
    try {
      if (!url) return;
      var str = typeof url === "string" ? url : url.toString();
      if (!isGoogleHit(str)) return;

      var u = new URL(str, location.href);
      var gcs = u.searchParams.get("gcs");
      var gcd = u.searchParams.get("gcd");
      if (gcs || gcd) {
        window.__AA_CONSENT_HITS.push({
          gcs: gcs,
          gcd: gcd,
          timestamp: Date.now(),
          vendor: classifyVendor(u.hostname, u.pathname),
          en: u.searchParams.get("en"),
        });
        if (window.__AA_CONSENT_HITS.length > 100) {
          window.__AA_CONSENT_HITS = window.__AA_CONSENT_HITS.slice(-50);
        }
      }
    } catch (e) {}
  }

  // Intercept sendBeacon
  var origBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function (url) {
    extractParams(url);
    return origBeacon.apply(navigator, arguments);
  };

  // Intercept fetch
  var origFetch = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    extractParams(url);
    return origFetch.apply(this, arguments);
  };

  // Intercept XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aa_url = url;
    return origOpen.apply(this, arguments);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    extractParams(this.__aa_url);
    return origSend.apply(this, arguments);
  };
}

// ---- UI: Consent Mode elements ----
const consentScanBtn = document.getElementById("consentScanBtn");
const consentResults = document.getElementById("consentResults");
const consentBanner = document.getElementById("consentBanner");
const consentBadge = document.getElementById("consentBadge");
const consentCMPRow = document.getElementById("consentCMPRow");
const consentCMPName = document.getElementById("consentCMPName");
const consentGCS = document.getElementById("consentGCS");
const consentGCSDesc = document.getElementById("consentGCSDesc");
const consentGCD = document.getElementById("consentGCD");
const consentGCDDesc = document.getElementById("consentGCDDesc");
const consentSignalsBody = document.getElementById("consentSignalsBody");
const consentGCDSection = document.getElementById("consentGCDSection");
const consentGCDDecoded = document.getElementById("consentGCDDecoded");
const consentAuditSection = document.getElementById("consentAuditSection");
const consentAuditBody = document.getElementById("consentAuditBody");
const consentHistorySection = document.getElementById("consentHistorySection");
const consentHistoryBody = document.getElementById("consentHistoryBody");
const consentNetworkSection = document.getElementById("consentNetworkSection");
const consentNetworkBody = document.getElementById("consentNetworkBody");
const consentVersionChip = document.getElementById("consentVersionChip");
const consentModeInfo = document.getElementById("consentModeInfo");
const consentModeType = document.getElementById("consentModeType");
const consentModeExtras = document.getElementById("consentModeExtras");
const consentGcdCalcInput = document.getElementById("consentGcdCalcInput");
const consentGcdCalcOut = document.getElementById("consentGcdCalcOut");
const consentCopyBtn = document.getElementById("consentCopyBtn");
const consentAuditDetails = document.getElementById("consentAuditDetails");
const consentAuditSummary = document.getElementById("consentAuditSummary");
const consentHitsInfoBtn = document.getElementById("consentHitsInfoBtn");
const consentHitsInfoPop = document.getElementById("consentHitsInfoPop");
const consentHitsEmpty = document.getElementById("consentHitsEmpty");

let consentInterceptorInjected = false;
let lastConsentData = null;
let lastConsentHost = "";

// Decode GCD string: format is 1[3x][3x][3x][3x]5
// Formato real: 1<d><L><d><L><d><L><d><L>… (p.ej. 13p3p3p3p5l1). Los dígitos son
// opacos y Google avisa de que los campos pueden cambiar: extraemos solo las 4 letras.
function decodeGCDString(gcd) {
  if (!gcd) return null;
  var m = String(gcd).match(/^1\d([a-z])\d([a-z])\d([a-z])\d([a-z])/i);
  if (!m) return null;
  var gcdTypes = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"];
  var decoded = {};
  for (var i = 0; i < gcdTypes.length; i++) {
    var ch = m[i + 1].toLowerCase();
    decoded[gcdTypes[i]] = { char: ch, info: GCD_CHARS[ch] || { label: "Desconocido (" + ch + ")", cls: "muted" } };
  }
  return decoded;
}

// Las 4 letras de un gcd, para comparar códigos sin depender de la cola variable
function gcdLetters(gcd) {
  var m = String(gcd || "").match(/^1\d([a-z])\d([a-z])\d([a-z])\d([a-z])/i);
  return m ? (m[1] + m[2] + m[3] + m[4]).toLowerCase() : null;
}

// =============================================
// Consent Mode audit rules (declarative)
// =============================================
// Each rule has:
//   id:          stable identifier (kebab-case)
//   title:       short headline shown in the rules popover
//   description: plain-language explanation of what is being checked
//   severity:    'error' | 'warn' | 'info'
//   docs:        URL to the source of truth (Google documentation)
//   terminal:    optional; if true, stops further checks when triggered
//   check(ctx):  function that returns null / string / string[]
//                - string: single finding message
//                - string[]: multiple finding messages (one rule, many hits)
//                - null or undefined: rule passes (no finding)
//
// To add a new rule (e.g. when Google publishes new guidance):
//   1) Append a new object to CONSENT_AUDIT_RULES below
//   2) Reference the official docs URL in `docs`
//   3) Implement `check` against the `ctx` helper
// The rule appears automatically in the "i" popover and in the audit output.
const CONSENT_AUDIT_RULES = [
  {
    id: "not-configured",
    title: "Consent Mode debe estar configurado",
    description: "La web debe declarar al menos un gtag('consent','default',…) o un 'update' para respetar las categorías de consentimiento del usuario.",
    severity: "error",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    terminal: true,
    check: function (ctx) {
      if (!ctx.data || !ctx.data.detected || (!ctx.hasAnyDefault && !ctx.hasAnyUpdate)) {
        return "Consent Mode no está configurado en esta web. No se están respetando las categorías de consentimiento — GA4 y publicidad envían datos sin control.";
      }
    },
  },
  {
    id: "v2-ad-user-data-missing",
    title: "Falta ad_user_data (Consent Mode v2)",
    description: "ad_user_data es una señal de Consent Mode v2 requerida para tráfico del EEE, UK y Suiza desde marzo de 2024 cuando se usan funciones de medición basadas en datos de usuario (Enhanced Conversions, user_id, Customer Match) o audiencias. Sin ella no se envían datos de usuario a Google Ads (peor matching) y los usuarios europeos quedan fuera de las audiencias.",
    severity: "error",
    docs: "https://support.google.com/tagmanager/answer/13695607",
    check: function (ctx) {
      if (ctx.usingAdsOrAnalytics && !ctx.has("ad_user_data")) {
        return "Falta ad_user_data (Consent Mode v2, EEA/UK/Suiza desde marzo 2024). Sin ella no se envían datos de usuario a Google (Enhanced Conversions, user_id, Customer Match): las conversiones europeas pierden matching y los usuarios EEA se excluyen de audiencias/remarketing.";
      }
    },
  },
  {
    id: "v2-ad-personalization-missing",
    title: "Falta ad_personalization (Consent Mode v2)",
    description: "ad_personalization es una señal de Consent Mode v2 requerida para tráfico del EEE, UK y Suiza desde marzo de 2024 para publicidad personalizada y remarketing. Sin ella, los usuarios europeos no entran en audiencias ni reciben anuncios personalizados.",
    severity: "error",
    docs: "https://support.google.com/tagmanager/answer/13695607",
    check: function (ctx) {
      if (ctx.usingAdsOrAnalytics && !ctx.has("ad_personalization")) {
        return "Falta ad_personalization (Consent Mode v2, EEA/UK/Suiza desde marzo 2024). Sin ella, los usuarios europeos quedan excluidos de audiencias, remarketing y personalización de anuncios.";
      }
    },
  },
  {
    id: "sensitive-default-granted",
    title: "Defaults deben ser 'denied' para señales sensibles",
    description: "Para tráfico EEE/UK, ePrivacy y RGPD exigen que las señales que implican cookies no esenciales partan de default='denied'. El ejemplo oficial de Google cubre ad_storage, ad_user_data, ad_personalization y analytics_storage; personalization_storage se incluye como buena práctica de esta auditoría. Un default 'granted' implica tracking antes del consentimiento.",
    severity: "warn",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      var msgs = [];
      ctx.SENSITIVE.forEach(function (k) {
        if (ctx.getDef(k) === "granted") {
          msgs.push(k + " tiene default = granted. Para tráfico EEE debería partir de 'denied' (ePrivacy/RGPD" + (k === "personalization_storage" ? "; buena práctica, no señal de Consent Mode" : "; ejemplo oficial de Google") + ") — el usuario recibe tracking antes de consentir.");
        }
      });
      return msgs.length ? msgs : null;
    },
  },
  {
    id: "wait-for-update-missing",
    title: "wait_for_update recomendado con CMPs asíncronas",
    description: "Si la CMP carga asíncronamente, los primeros eventos pueden dispararse antes del update y perder el consentimiento. Google recomienda ~500ms.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      if (!ctx.data.waitForUpdate) {
        return "No se detecta wait_for_update. Con CMPs asíncronos pueden perderse los primeros eventos antes del update. Recomendado: 500ms.";
      }
    },
  },
  {
    id: "ad-user-data-requires-ad-storage",
    title: "ad_user_data granted con ad_storage denied (combinación inusual)",
    description: "Son señales independientes según Google: ad_storage controla las cookies publicitarias y ad_user_data el envío de datos de usuario (Enhanced Conversions, user_id). No es un error, pero la mayoría de CMPs las agrupan en la misma categoría.",
    severity: "info",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.ad === "denied" && ctx.adUserData === "granted") {
        return "ad_user_data = granted con ad_storage = denied. Combinación inusual (la mayoría de CMPs las agrupan en la categoría de marketing); comprueba el mapeo del CMP.";
      }
    },
  },
  {
    id: "ad-personalization-requires-ad-storage",
    title: "ad_personalization granted con ad_storage denied (combinación inusual)",
    description: "Son señales independientes según Google: ad_storage controla las cookies publicitarias y ad_personalization la personalización de anuncios. No es un error, pero la mayoría de CMPs las agrupan en la misma categoría.",
    severity: "info",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.ad === "denied" && ctx.adPers === "granted") {
        return "ad_personalization = granted con ad_storage = denied. Combinación inusual (la mayoría de CMPs las agrupan en la categoría de marketing); comprueba el mapeo del CMP.";
      }
    },
  },
  {
    id: "personalization-storage-needs-consent",
    title: "personalization_storage granted sin consentimiento de ads/analytics",
    description: "personalization_storage es un 'privacy parameter' que Google no evalúa en sus etiquetas (solo actúa vía additional consent checks). No es estrictamente necesaria según ePrivacy, así que solo debería estar granted si el usuario aceptó una categoría de preferencias/personalización en la CMP.",
    severity: "info",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.bothDenied && ctx.pers === "granted") {
        return "personalization_storage = granted con ad_storage y analytics_storage denegados. Comprueba que la CMP lo enlaza a una categoría aceptada por el usuario; si no, debería ser denied (buena práctica ePrivacy, no un requisito de Google).";
      }
    },
  },
  {
    id: "functionality-storage-strictly-necessary",
    title: "functionality_storage sólo granted si es estrictamente necesario",
    description: "Cuando ads + analytics están denegados, functionality_storage sólo debería ser granted si cubre funciones estrictamente necesarias (idioma, sesión básica). Si incluye tracking, debe denegarse.",
    severity: "info",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.bothDenied && ctx.func === "granted") {
        return "functionality_storage = granted sin consentimiento de analítica/publicidad. Aceptable sólo si cubre funciones estrictamente necesarias (idioma, sesión básica).";
      }
    },
  },
  {
    id: "security-storage-usually-granted",
    title: "security_storage suele mantenerse granted",
    description: "security_storage cubre antifraude y autenticación y habitualmente se mantiene granted incluso sin consentimiento, porque se considera estrictamente necesaria.",
    severity: "info",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.bothDenied && ctx.sec === "denied") {
        return "security_storage = denied. Lo habitual es mantenerlo granted para antifraude/sesión, incluso sin consentimiento.";
      }
    },
  },
  {
    id: "ad-granted-user-data-denied",
    title: "ad_storage granted pero ad_user_data denied",
    description: "Con ad_user_data denied no se envían enhanced conversions (datos first-party hasheados) ni user_id, y la exportación de conversiones por click ID hacia Google Ads queda limitada. Las conversiones básicas siguen midiéndose.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/concepts/consent-mode",
    check: function (ctx) {
      if (ctx.ad === "granted" && ctx.adUserData === "denied") {
        return "ad_storage = granted pero ad_user_data = denied: no se envían enhanced conversions ni user_id y la exportación de conversiones por click ID queda limitada. Suele indicar un mapeo de CMP incompleto.";
      }
    },
  },
  {
    id: "security-denied-when-accepted",
    title: "security_storage denied con aceptación total es anómalo",
    description: "Cuando el usuario acepta todo, security_storage debería estar granted. Si sigue denied, probablemente hay un bug en la CMP.",
    severity: "warn",
    docs: "https://support.google.com/tagmanager/answer/13802165",
    check: function (ctx) {
      if (ctx.ad === "granted" && ctx.an === "granted" && ctx.sec === "denied") {
        return "security_storage = denied con consentimiento aceptado. Posible bug en la CMP — esta señal debería estar granted casi siempre.";
      }
    },
  },
  {
    id: "update-without-default",
    title: "default debe ejecutarse antes del primer update",
    description: "Si se dispara gtag('consent','update',...) sin un gtag('consent','default',...) previo, las etiquetas que hayan disparado antes envían hits con las señales sin definir (Google las trata como granted) y el default nunca llega a aplicarse.",
    severity: "warn",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      if (ctx.updateCalls.length > 0 && ctx.defaultCalls.length === 0) {
        return "Se detectó gtag('consent','update',...) sin gtag('consent','default',...) previo. Según Google, el default debe ejecutarse antes de cargar gtag/GTM y antes de cualquier config/event; sin él los hits previos salen con señales sin definir (tratadas como granted).";
      }
    },
  },
  {
    id: "default-after-update-order",
    title: "Orden default → update en dataLayer",
    description: "El default debe aparecer antes del primer update en dataLayer y antes de cargar gtag/GTM. Si se invierte el orden, el default no surte efecto (no anula un update ya aplicado) y los hits previos salen con señales sin definir, tratadas como granted.",
    severity: "warn",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      if (ctx.defaultCalls.length > 0 && ctx.updateCalls.length > 0) {
        var firstDef = ctx.defaultCalls[0].index != null ? ctx.defaultCalls[0].index : -1;
        var firstUpd = ctx.updateCalls[0].index != null ? ctx.updateCalls[0].index : -1;
        if (firstUpd >= 0 && firstDef >= 0 && firstUpd < firstDef) {
          return "El primer update se ejecutó antes que el default en dataLayer. El orden correcto es default → carga de gtag/GTM → update; en caso contrario el default no surte efecto y los hits previos al update salen con señales sin definir (tratadas como granted). Un default posterior NO sobrescribe un update ya aplicado.";
        }
      }
    },
  },
  {
    id: "multiple-defaults",
    title: "Defaults solapados con el mismo ámbito regional",
    description: "Google permite varios gtag('consent','default',…) por página (uno global + uno por región; el más específico prevalece). Solo es problemático que dos defaults fijen la misma señal para el mismo ámbito: el orden de ejecución decide y el resultado es frágil.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/guides/consent#region-specific_behavior",
    check: function (ctx) {
      var CONSENT_KEYS = ["ad_storage", "ad_user_data", "ad_personalization", "analytics_storage", "functionality_storage", "personalization_storage", "security_storage"];
      var calls = ctx.defaultCalls;
      if (calls.length < 2) return;
      var seen = {}, conflicts = [];
      calls.forEach(function (c, ci) {
        var cfg = c.config || {};
        var regions = Array.isArray(cfg.region) && cfg.region.length ? cfg.region.map(String) : ["global"];
        var keys = Object.keys(cfg).filter(function (k) { return CONSENT_KEYS.indexOf(k) !== -1; });
        regions.forEach(function (r) {
          keys.forEach(function (k) {
            var id = r + "|" + k;
            if (seen[id] != null && seen[id] !== ci) conflicts.push(k + " (" + (r === "global" ? "global" : "region " + r) + ")");
            else if (seen[id] == null) seen[id] = ci;
          });
        });
      });
      if (conflicts.length) {
        var uniq = conflicts.filter(function (v, i, a) { return a.indexOf(v) === i; });
        return "Se detectaron " + calls.length + " llamadas a gtag('consent','default',...) que fijan la misma señal para el mismo ámbito: " + uniq.join(", ") + ". El resultado depende del orden de ejecución. Un default global + defaults por región (más específicos) es correcto y no genera este aviso.";
      }
    },
  },
  {
    id: "ads-data-redaction-recommended",
    title: "ads_data_redaction: minimización de datos con publicidad denegada",
    description: "Con ad_storage denegado, ads_data_redaction=true redacta los identificadores de clic (gclid/dclid) de los pings cookieless de Google Ads y Floodlight. Es una opción de minimización de datos, no una recomendación explícita de Google; no afecta a GA4 y no tiene efecto si ad_storage está granted.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      if (ctx.ad === "denied" && ctx.data.adsDataRedaction !== true) {
        return "ad_storage está denegado pero ads_data_redaction no está activo. Valora activarlo para redactar gclid/dclid de los pings de Google Ads/Floodlight sin consentimiento (minimización de datos; GA4 no se ve afectado).";
      }
    },
  },
  {
    id: "url-passthrough-hint",
    title: "url_passthrough conserva los click IDs sin cookies",
    description: "Con ad_storage denegado, url_passthrough=true pasa gclid/dclid/wbraid por la URL entre páginas, conservando la atribución de campañas sin usar cookies.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/guides/consent",
    check: function (ctx) {
      if (ctx.ad === "denied" && ctx.data.urlPassthrough !== true) {
        return "ad_storage está denegado y url_passthrough no está activo. Sin él se pierde el gclid al navegar — valora activarlo para conservar la atribución.";
      }
    },
  },
  {
    id: "advanced-mode-pings",
    title: "Modo Avanzado: pings sin consentimiento",
    description: "Se detectaron hits de Google enviados con todo el consentimiento denegado (gcs=G100). Es el comportamiento del modo Avanzado — válido para Google, pero algunas autoridades europeas lo cuestionan; confirma que encaja con tu política de privacidad.",
    severity: "info",
    docs: "https://support.google.com/analytics/answer/9976101",
    check: function (ctx) {
      if (ctx.deniedPings.length > 0) {
        return "Se enviaron " + ctx.deniedPings.length + " pings cookieless con el consentimiento denegado (modo Avanzado). Confirma que tu política de privacidad lo contempla.";
      }
    },
  },
  {
    id: "region-specific-defaults",
    title: "Defaults por región (parámetro region)",
    description: "gtag('consent','default',…) acepta un array region para aplicar denied sólo donde la ley lo exige (p.ej. EEA) y granted en el resto, maximizando datos donde es legal.",
    severity: "info",
    docs: "https://developers.google.com/tag-platform/security/guides/consent#region-specific_behavior",
    check: function (ctx) {
      if (ctx.defaultCalls.length > 0 && ctx.data.regions.length === 0 && ctx.getDef("ad_storage") === "denied") {
        return "El default denegado se aplica globalmente (sin parámetro region). Valora defaults por región: denied sólo en EEA/UK y granted donde no se exige consentimiento previo.";
      }
    },
  },
];

// Build a shared context object with all derived values the rules need.
function buildConsentAuditContext(data) {
  var get = function (key) {
    var s = data && data.signals && data.signals[key];
    return s && s.current !== "not set" ? s.current : null;
  };
  var getDef = function (key) {
    var s = data && data.signals && data.signals[key];
    return s ? s.default : null;
  };
  var has = function (key) {
    var s = data && data.signals && data.signals[key];
    return !!(s && (s.default || s.update));
  };
  var hasAnyDefault = data && CONSENT_TYPES.some(function (ct) {
    var s = data.signals[ct.key]; return s && s.default;
  });
  var hasAnyUpdate = data && CONSENT_TYPES.some(function (ct) {
    var s = data.signals[ct.key]; return s && s.update;
  });
  var ad = get("ad_storage");
  var an = get("analytics_storage");
  var history = (data && data.consentHistory) || [];
  return {
    data: data,
    get: get, getDef: getDef, has: has,
    hasAnyDefault: hasAnyDefault, hasAnyUpdate: hasAnyUpdate,
    ad: ad,
    an: an,
    adUserData: get("ad_user_data"),
    adPers: get("ad_personalization"),
    pers: get("personalization_storage"),
    func: get("functionality_storage"),
    sec: get("security_storage"),
    SENSITIVE: ["ad_storage", "ad_user_data", "ad_personalization", "analytics_storage", "personalization_storage"],
    usingAdsOrAnalytics: has("ad_storage") || has("analytics_storage") || has("ad_user_data") || has("ad_personalization"),
    bothDenied: ad === "denied" && an === "denied",
    networkHits: (data && data.networkHits) || [],
    deniedPings: ((data && data.networkHits) || []).filter(function (h) { return h.gcs === "G100"; }),
    defaultCalls: history.filter(function (h) { return h.action === "default"; }),
    updateCalls: history.filter(function (h) { return h.action === "update"; }),
  };
}

function auditConsent(data) {
  var ctx = buildConsentAuditContext(data);
  var findings = [];
  for (var i = 0; i < CONSENT_AUDIT_RULES.length; i++) {
    var rule = CONSENT_AUDIT_RULES[i];
    var result;
    try { result = rule.check(ctx); } catch (e) { continue; }
    if (!result) continue;
    var msgs = Array.isArray(result) ? result : [result];
    for (var j = 0; j < msgs.length; j++) {
      findings.push({ severity: rule.severity, message: msgs[j], ruleId: rule.id });
    }
    if (rule.terminal) return findings;
  }
  var ORDER = { error: 0, warn: 1, info: 2, ok: 3 };
  findings.sort(function (a, b) { return ORDER[a.severity] - ORDER[b.severity]; });
  if (findings.length === 0) {
    findings.push({ severity: "ok", message: "Configuración coherente con Consent Mode v2 y con el consentimiento del usuario." });
  }
  return findings;
}

function renderConsentResults(data) {
  if (!data) return;
  lastConsentData = data;

  consentResults.classList.remove("hidden");

  // Detect consent configuration state:
  //  - hasAnyDefault: at least one gtag('consent','default',…) fired
  //  - hasAnyUpdate: at least one gtag('consent','update',…) fired
  var hasAnyDefault = CONSENT_TYPES.some(function (ct) {
    var s = data.signals[ct.key];
    return s && s.default;
  });
  var hasAnyUpdate = CONSENT_TYPES.some(function (ct) {
    var s = data.signals[ct.key];
    return s && s.update;
  });
  // No Consent Mode at all, or a stray event fired but no actual signals configured
  var notConfigured = !data.detected || (!hasAnyDefault && !hasAnyUpdate);
  // Defaults set but user hasn't decided yet
  var awaiting = !notConfigured && !hasAnyUpdate;

  // Banner — differentiate "implemented" from "consent granted"
  var diagText = "";
  var diagTone = "neutral";
  if (notConfigured) {
    consentBanner.className = "cm-banner cm-banner-alert";
    consentBadge.textContent = "No configurado";
    consentBadge.className = "cm-badge cm-badge-alert";
    diagText = "Sin Consent Mode: GA4 y Ads reciben datos sin control del usuario.";
    diagTone = "alert";
  } else if (awaiting) {
    consentBanner.className = "cm-banner cm-banner-pending";
    consentBadge.textContent = "Pendiente";
    consentBadge.className = "cm-badge cm-badge-pending";
    diagText = "Sin decisión del usuario — se aplica el default. Acepta o rechaza en la web y re-escanea.";
    diagTone = "pending";
  } else if (data.gcsCode === "G111") {
    consentBanner.className = "cm-banner cm-banner-granted";
    consentBadge.textContent = "Aceptado";
    consentBadge.className = "cm-badge cm-badge-granted";
    diagText = "Todo aceptado: GA4 y Ads reciben datos completos.";
    diagTone = "ok";
  } else if (data.gcsCode === "G100") {
    consentBanner.className = "cm-banner cm-banner-denied";
    consentBadge.textContent = "Denegado";
    consentBadge.className = "cm-badge cm-badge-denied";
    diagText = "Todo denegado: como mucho, pings anónimos sin cookies.";
    diagTone = "neutral";
  } else if (data.gcsCode === "G110") {
    consentBanner.className = "cm-banner cm-banner-partial";
    consentBadge.textContent = "Parcial";
    consentBadge.className = "cm-badge cm-badge-partial";
    diagText = "Consentimiento parcial: publicidad aceptada, analítica denegada.";
    diagTone = "partial";
  } else if (data.gcsCode === "G101") {
    consentBanner.className = "cm-banner cm-banner-partial";
    consentBadge.textContent = "Parcial";
    consentBadge.className = "cm-badge cm-badge-partial";
    diagText = "Consentimiento parcial: analítica aceptada, publicidad denegada.";
    diagTone = "partial";
  } else {
    consentBanner.className = "cm-banner cm-banner-active";
    consentBadge.textContent = "Implementado";
    consentBadge.className = "cm-badge cm-badge-active";
    diagText = "Consent Mode implementado — estado personalizado o en transición.";
    diagTone = "neutral";
  }
  // El diagnóstico ya no ocupa espacio: va como tooltip del banner
  consentBanner.title = diagText;

  // CMP
  if (data.cmp) {
    consentCMPRow.classList.remove("hidden");
    consentCMPName.textContent = data.cmp;
  } else {
    consentCMPRow.classList.add("hidden");
  }

  // Versión v1/v2 (chip en el banner)
  if (consentVersionChip) {
    if (data.detected) {
      consentVersionChip.textContent = data.v2 ? "v2" : "v1";
      consentVersionChip.className = "cm-version-chip " + (data.v2 ? "cm-version-v2" : "cm-version-v1");
      consentVersionChip.classList.remove("hidden");
    } else {
      consentVersionChip.classList.add("hidden");
    }
  }

  // Implementación: un chip (Avanzado/Básico) + extras sólo si existen
  if (consentModeInfo) {
    if (data.detected) {
      consentModeInfo.classList.remove("hidden");
      var hits = data.networkHits || [];
      var hasDeniedPing = hits.some(function (h) { return h.gcs === "G100"; });
      var adNow = data.signals.ad_storage && data.signals.ad_storage.current;
      var anNow = data.signals.analytics_storage && data.signals.analytics_storage.current;
      var deniedNow = adNow === "denied" && anNow === "denied";
      if (hasDeniedPing) {
        consentModeType.textContent = "Modo Avanzado";
        consentModeType.title = "Los tags cargan siempre y envían pings sin cookies aunque el consentimiento esté denegado.";
      } else if (deniedNow && hits.length === 0) {
        consentModeType.textContent = "Modo Básico (probable)";
        consentModeType.title = "Con el consentimiento denegado no se envía ningún hit — los tags quedan bloqueados hasta el update.";
      } else {
        consentModeType.textContent = "Modo por determinar";
        consentModeType.title = "Rechaza el consentimiento en la web y re-escanea para determinarlo.";
      }
      var extras = [];
      if (data.waitForUpdate) extras.push("wait_for_update " + data.waitForUpdate + " ms");
      if (data.adsDataRedaction) extras.push("ads_data_redaction");
      if (data.urlPassthrough) extras.push("url_passthrough");
      if (data.regions.length > 0) extras.push("region " + data.regions.join(","));
      consentModeExtras.textContent = extras.join(" · ");
    } else {
      consentModeInfo.classList.add("hidden");
    }
  }

  // Audit
  var findings = auditConsent(data);
  var AUDIT_ICONS = { ok: "i-check-circle", info: "i-info", warn: "i-info", error: "i-ban" };
  consentAuditBody.innerHTML = "";
  findings.forEach(function (f) {
    var row = document.createElement("div");
    row.className = "cm-audit-item cm-audit-" + f.severity;
    row.innerHTML =
      '<span class="cm-audit-icon"><svg><use href="#' + (AUDIT_ICONS[f.severity] || "i-info") + '"/></svg></span>' +
      '<span class="cm-audit-msg"></span>';
    row.querySelector(".cm-audit-msg").textContent = f.message;
    consentAuditBody.appendChild(row);
  });
  // Resumen compacto en el summary; sólo se auto-abre si hay errores
  var nErr = findings.filter(function (f) { return f.severity === "error"; }).length;
  var nWarn = findings.filter(function (f) { return f.severity === "warn"; }).length;
  var nInfo = findings.filter(function (f) { return f.severity === "info"; }).length;
  if (consentAuditSummary) {
    var parts = [];
    if (nErr) parts.push('<span class="cm-audit-count cm-count-err">' + nErr + ' error' + (nErr > 1 ? "es" : "") + '</span>');
    if (nWarn) parts.push('<span class="cm-audit-count cm-count-warn">' + nWarn + ' aviso' + (nWarn > 1 ? "s" : "") + '</span>');
    if (nInfo) parts.push('<span class="cm-audit-count cm-count-info">' + nInfo + ' info</span>');
    if (!parts.length) parts.push('<span class="cm-audit-count cm-count-ok">todo correcto \u2713</span>');
    consentAuditSummary.innerHTML = 'Auditoría ' + parts.join(" ");
  }
  if (consentAuditDetails) consentAuditDetails.open = nErr > 0;
  consentAuditSection.classList.remove("hidden");

  // GCS — always use calculated (reflects current state)
  if (data.gcsCode) {
    consentGCS.textContent = data.gcsCode;
    consentGCSDesc.textContent = GCS_DESC[data.gcsCode] || "";
  } else {
    consentGCS.textContent = data.detected ? "Sin datos" : "\u2014";
    consentGCSDesc.textContent = "";
  }

  // GCD — use calculated code (matches current signals), show network raw as secondary
  var gcdCalc = data.gcdCode;
  if (gcdCalc && data.detected) {
    consentGCD.textContent = gcdCalc;
    var lc = gcdLetters(gcdCalc), lr = gcdLetters(data.gcdRaw);
    consentGCDDesc.textContent = (data.gcdRaw && lr && lc && lr !== lc)
      ? "Red: " + data.gcdRaw
      : "";
  } else {
    consentGCD.textContent = data.detected ? "Sin datos" : "\u2014";
    consentGCDDesc.textContent = "";
  }

  // Señales — tabla grande estilo inspector: Señal | Default | Actual
  consentSignalsBody.innerHTML = "";
  var sigHead = document.createElement("div");
  sigHead.className = "cm-sig-row cm-sig-head";
  sigHead.innerHTML = "<span>Señal</span><span>Default</span><span>Actual</span>";
  consentSignalsBody.appendChild(sigHead);
  // Ojo con la semántica: una señal SIN declarar no es "denied" — los tags de
  // Google actúan como si fuese granted. Para las señales sensibles eso es un
  // fallo de configuración y se marca en ámbar.
  var SENSITIVE_SIGNALS = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization", "personalization_storage"];
  var pill = function (v, opts) {
    opts = opts || {};
    if (!v) {
      if (opts.updateCol) {
        return '<span class="cm-pill cm-pill-unset" title="Sin update todavía — el usuario no ha interactuado con el banner">—</span>';
      }
      if (opts.sensitive) {
        return '<span class="cm-pill cm-pill-missing" title="Sin configurar: al no declararse, los tags de Google actúan como si fuese GRANTED (tracking sin consentimiento). En EEA debería declararse denied por defecto.">sin definir ⚠</span>';
      }
      return '<span class="cm-pill cm-pill-unset" title="Sin configurar — para esta señal suele ser aceptable (por defecto se comporta como granted)">sin definir</span>';
    }
    return '<span class="cm-pill cm-pill-' + v + '">' + v + '</span>';
  };
  CONSENT_TYPES.forEach(function (ct) {
    var sig = data.signals[ct.key];
    var defVal = sig ? sig.default : null;
    var updVal = sig ? sig.update : null;
    var row = document.createElement("div");
    row.className = "cm-sig-row";
    row.title = CONSENT_SIGNAL_INFO[ct.key] || "";
    row.innerHTML =
      '<span class="cm-sig-name">' + ct.label + '</span>' +
      pill(defVal, { sensitive: SENSITIVE_SIGNALS.indexOf(ct.key) !== -1 }) +
      pill(updVal, { updateCol: true });
    consentSignalsBody.appendChild(row);
  });

  // GCD decoded — always from CALCULATED code (matches current signals)
  var gcdData = decodeGCDString(gcdCalc);
  if (gcdData && data.detected) {
    consentGCDSection.classList.remove("hidden");
    consentGCDDecoded.innerHTML = "";
    var gcdTypes = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"];
    gcdTypes.forEach(function (type) {
      var entry = gcdData[type];
      if (!entry) return;
      var row = document.createElement("div");
      row.className = "cm-gcd-row";
      row.innerHTML =
        '<span class="cm-gcd-type">' + type + '</span>' +
        '<span class="cm-gcd-char">' + entry.char + '</span>' +
        '<span class="cm-gcd-meaning cm-gcd-' + entry.info.cls + '">' + entry.info.label + '</span>';
      consentGCDDecoded.appendChild(row);
    });
  } else {
    consentGCDSection.classList.add("hidden");
  }

  // Consent history
  if (data.consentHistory.length > 0) {
    consentHistorySection.classList.remove("hidden");
    consentHistoryBody.innerHTML = "";
    data.consentHistory.forEach(function (h) {
      var div = document.createElement("div");
      div.className = "cm-history-entry";

      var actionBadge = document.createElement("span");
      actionBadge.className = "cm-history-action cm-history-" + (h.action === "default" ? "default" : "update");
      actionBadge.textContent = h.action;

      var configPre = document.createElement("pre");
      configPre.className = "cm-history-config";
      var configObj = Object.assign({}, h.config);
      delete configObj.event;
      configPre.textContent = JSON.stringify(configObj, null, 2);

      div.appendChild(actionBadge);
      div.appendChild(configPre);
      consentHistoryBody.appendChild(div);
    });
  } else {
    consentHistorySection.classList.add("hidden");
  }

  // Hits de Google — solo los que llevan estado de consentimiento (gcs)
  var stateHits = data.networkHits.filter(function (h) { return h.gcs; });
  if (consentHitsEmpty) consentHitsEmpty.classList.toggle("hidden", stateHits.length > 0);
  if (stateHits.length > 0) {
    consentNetworkSection.classList.remove("hidden");
    consentNetworkBody.innerHTML = "";
    stateHits.slice().reverse().forEach(function (hit) {
      var div = document.createElement("div");
      var denied = hit.gcs === "G100";
      div.className = "cm-network-hit" + (denied ? " cm-hit-denied" : "");
      var time = new Date(hit.timestamp).toLocaleTimeString("es-ES", { hour12: false });
      div.title = "gcs=" + hit.gcs + (hit.gcd ? " · gcd=" + hit.gcd : "");
      div.innerHTML =
        '<span class="cm-net-time">' + time + '</span>' +
        '<span class="cm-net-vendor">' + escapeHtml(hit.vendor || "Google") + '</span>' +
        (hit.en ? '<span class="cm-net-event">' + escapeHtml(hit.en) + '</span>' : '') +
        '<span class="cm-net-spacer"></span>' +
        hitStatePill(hit.gcs);
      consentNetworkBody.appendChild(div);
    });
  } else {
    consentNetworkSection.classList.add("hidden");
  }
}

// Una sola píldora de estado por hit: ✓ (todo), parcial, ✕ (nada)
function hitStatePill(gcs) {
  if (!gcs || !/^G1[01][01]$/.test(gcs)) return "";
  var ad = gcs[2] === "1", an = gcs[3] === "1";
  var tip = "ads " + (ad ? "\u2713" : "\u2715") + " · analytics " + (an ? "\u2713" : "\u2715") + " (" + gcs + ")";
  if (ad && an) return '<span class="cm-hit-state cm-hit-ok" title="' + tip + '">\u2713</span>';
  if (!ad && !an) return '<span class="cm-hit-state cm-hit-no" title="' + tip + '">\u2715</span>';
  return '<span class="cm-hit-state cm-hit-mid" title="' + tip + '">parcial</span>';
}

// ---- Calculadora GCD (pega cualquier valor gcd y lo decodifica) ----
function renderGcdCalc() {
  if (!consentGcdCalcInput || !consentGcdCalcOut) return;
  var raw = consentGcdCalcInput.value.trim();
  consentGcdCalcOut.innerHTML = "";
  if (!raw) return;
  var decoded = decodeGCDString(raw);
  if (!decoded) {
    consentGcdCalcOut.innerHTML = '<div class="cm-calc-invalid">Formato no reconocido — un gcd válido empieza por 1 y alterna dígito+letra, p.ej. 13p3p3p3p5l1</div>';
    return;
  }
  Object.keys(decoded).forEach(function (type) {
    var entry = decoded[type];
    var row = document.createElement("div");
    row.className = "cm-gcd-row";
    row.innerHTML =
      '<span class="cm-gcd-type">' + type + '</span>' +
      '<span class="cm-gcd-char">' + escapeHtml(entry.char) + '</span>' +
      '<span class="cm-gcd-meaning cm-gcd-' + entry.info.cls + '">' + entry.info.label + '</span>';
    consentGcdCalcOut.appendChild(row);
  });
}
if (consentGcdCalcInput) consentGcdCalcInput.addEventListener("input", renderGcdCalc);

// ---- Sub-pestañas del Consent (Estado / Pings) ----
document.querySelectorAll(".cm-tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".cm-tab").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
    var key = btn.dataset.cmtab;
    var estado = document.getElementById("cmTabEstado");
    var hits = document.getElementById("cmTabHits");
    if (estado) estado.classList.toggle("hidden", key !== "estado");
    if (hits) hits.classList.toggle("hidden", key !== "hits");
  });
});

// ---- Popover "i" de los hits: qué significa "ping sin consentimiento" ----
if (consentHitsInfoBtn && consentHitsInfoPop) {
  consentHitsInfoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    consentHitsInfoPop.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (consentHitsInfoPop.classList.contains("hidden")) return;
    if (consentHitsInfoPop.contains(e.target) || consentHitsInfoBtn.contains(e.target)) return;
    consentHitsInfoPop.classList.add("hidden");
  });
}

// ---- Copiar informe de Consent Mode (para compartir con el equipo) ----
function buildConsentReport(data) {
  var L = [];
  L.push("CONSENT MODE — " + (lastConsentHost || "página actual") + " — " + new Date().toLocaleString("es-ES"));
  L.push("Estado: " + consentBadge.textContent + (data.gcsCode ? " (" + data.gcsCode + ")" : "") + " · Versión: " + (data.v2 ? "v2" : "v1") + (data.cmp ? " · CMP: " + data.cmp : ""));
  L.push("wait_for_update: " + (data.waitForUpdate ? data.waitForUpdate + " ms" : "no detectado") +
         " · ads_data_redaction: " + (data.adsDataRedaction === null ? "no detectado" : data.adsDataRedaction ? "activo" : "off") +
         " · url_passthrough: " + (data.urlPassthrough === null ? "no detectado" : data.urlPassthrough ? "activo" : "off") +
         " · region: " + (data.regions.length ? data.regions.join(",") : "global"));
  L.push("");
  L.push("Señales:");
  CONSENT_TYPES.forEach(function (ct) {
    var sig = data.signals[ct.key];
    if (!sig) return;
    var line = "  " + ct.key + ": " + (sig.current || "not set");
    if (sig.default && sig.update && sig.default !== sig.update) line += "  (default " + sig.default + " \u2192 " + sig.update + ")";
    else if (sig.default && !sig.update) line += "  (default, sin update)";
    L.push(line);
  });
  var findings = auditConsent(data);
  L.push("");
  L.push("Auditoría:");
  findings.forEach(function (f) { L.push("  [" + f.severity.toUpperCase() + "] " + f.message); });
  if (data.networkHits.length > 0) {
    L.push("");
    L.push("Hits de Google (últimos " + data.networkHits.length + "):");
    data.networkHits.forEach(function (h) {
      L.push("  " + new Date(h.timestamp).toLocaleTimeString("es-ES", { hour12: false }) + "  " + (h.vendor || "Google") + (h.en ? " " + h.en : "") + (h.gcs ? "  gcs=" + h.gcs : "") + (h.gcs === "G100" ? "  [ping sin consentimiento]" : ""));
    });
  }
  return L.join("\n");
}
if (consentCopyBtn) consentCopyBtn.addEventListener("click", async () => {
  if (!lastConsentData) { showStatus("Primero escanea la página", "error"); return; }
  try {
    await navigator.clipboard.writeText(buildConsentReport(lastConsentData));
    showStatus("Informe de Consent Mode copiado", "success");
  } catch (e) {
    showStatus("No se pudo copiar", "error");
  }
});

async function runConsentScan() {
  // Solo comprobar (nunca pedir aquí): esta función corre al abrir el popup y
  // un permissions.request() sin gesto de usuario cerraría el popup.
  if (!await hasHostPermissions()) {
    const prompt = document.getElementById("consentPermPrompt");
    if (prompt) {
      consentResults.classList.add("hidden");
      prompt.classList.remove("hidden");
      renderPermissionPrompt(prompt, () => {
        prompt.classList.add("hidden");
        consentResults.classList.remove("hidden");
        runConsentScan();
      });
    }
    return;
  }
  {
    const prompt = document.getElementById("consentPermPrompt");
    if (prompt) prompt.classList.add("hidden");
    consentResults.classList.remove("hidden");
  }

  const tabId = await getActiveTabId();
  if (!tabId) {
    showStatus("No se pudo obtener la pestaña activa", "error");
    return;
  }

  try {
    const t = await chrome.tabs.get(tabId);
    lastConsentHost = t.url ? new URL(t.url).hostname : "";
  } catch (e) {}

  // Always re-inject in panel mode (page may have navigated)
  if (IS_PANEL) consentInterceptorInjected = false;

  // Inject network interceptor once
  if (!consentInterceptorInjected) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: consentNetworkInterceptor,
        world: "MAIN",
      });
      consentInterceptorInjected = true;
    } catch (e) {}
  }

  // Run the scan
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scanConsentMode,
      world: "MAIN",
    });

    if (result && result.result) {
      renderConsentResults(result.result);
    }
  } catch (e) {
    showStatus("Error al escanear: " + e.message, "error");
  }
}

// Manual scan button — el click es un gesto válido, así que aquí sí podemos pedir permisos
consentScanBtn.addEventListener("click", async () => {
  if (!await ensureHostPermissions()) {
    showStatus("Se necesitan permisos de acceso a la página", "error");
    return;
  }
  consentInterceptorInjected = false;
  runConsentScan();
});

// Rules popover — renders CONSENT_AUDIT_RULES as an on-demand reference
(function initConsentRulesPopover() {
  const btn = document.getElementById("consentRulesBtn");
  const popover = document.getElementById("consentRulesPopover");
  const closeBtn = document.getElementById("consentRulesClose");
  const list = document.getElementById("consentRulesList");
  if (!btn || !popover || !list) return;

  let rendered = false;
  function renderRulesOnce() {
    if (rendered) return;
    // Acordeón compacto agrupado por severidad: una línea por regla,
    // la descripción sólo se muestra al desplegarla.
    const ORDER = [["error", "Errores"], ["warn", "Avisos"], ["info", "Info"]];
    ORDER.forEach(function (group) {
      const sevKey = group[0];
      const rules = CONSENT_AUDIT_RULES.filter(function (r) { return r.severity === sevKey; });
      if (rules.length === 0) return;

      const header = document.createElement("div");
      header.className = "cm-rules-group";
      header.innerHTML = '<span class="cm-rule-sev cm-rule-sev-' + sevKey + '">' + sevKey + '</span> ' + group[1] + ' (' + rules.length + ')';
      list.appendChild(header);

      rules.forEach(function (rule) {
        const item = document.createElement("details");
        item.className = "cm-rule cm-rule-" + rule.severity;

        const head = document.createElement("summary");
        head.className = "cm-rule-head";
        const title = document.createElement("span");
        title.className = "cm-rule-title";
        title.textContent = rule.title;
        head.appendChild(title);

        const desc = document.createElement("div");
        desc.className = "cm-rule-desc";
        desc.textContent = rule.description;

        item.appendChild(head);
        item.appendChild(desc);
        if (rule.docs) {
          const link = document.createElement("a");
          link.className = "cm-rule-link";
          link.href = rule.docs;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Ver documentación →";
          item.appendChild(link);
        }
        list.appendChild(item);
      });
    });
    rendered = true;
  }

  function open() {
    renderRulesOnce();
    popover.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  }
  function close() {
    popover.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (popover.classList.contains("hidden")) open(); else close();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);
  document.addEventListener("click", function (e) {
    if (popover.classList.contains("hidden")) return;
    if (popover.contains(e.target) || btn.contains(e.target)) return;
    close();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !popover.classList.contains("hidden")) close();
  });
})();

// =============================================
// COOKIE AUDIT — Cross-domain session monitoring
// =============================================

const caStartBtn = document.getElementById("caStartBtn");
const caStopBtn = document.getElementById("caStopBtn");
const caCheckBtn = document.getElementById("caCheckBtn");
const caClearBtn = document.getElementById("caClearBtn");
const caStatus = document.getElementById("caStatus");
const caResults = document.getElementById("caResults");

let caAuditActive = false;
let caInitialSnapshot = null;      // snapshot captured at audit-start
let caCurrentSnapshot = null;      // latest snapshot from audit-check
let caTimelineEvents = [];         // accumulated timeline (cookie/nav/xdomain events)
let caLastTimelineTs = 0;          // last seen event ts for incremental fetches
let caPollTimer = null;            // interval for timeline polling
let caCountdownTimer = null;       // interval for GA4 inactivity countdown tick
let caETLDplus1 = null;            // eTLD+1 of the audited origin

// ------------------------------------------------------------
//  Cross-domain Audit helpers (eTLD+1, GA4 parsing, validators)
// ------------------------------------------------------------
const CA_TWO_PART_TLDS = new Set([
  "co.uk","co.jp","co.kr","co.nz","co.za","co.in","co.il","co.id",
  "com.au","com.br","com.mx","com.ar","com.cn","com.tr","com.co","com.pe","com.ve",
  "com.sg","com.hk","com.tw","com.my","com.ph","com.pk","com.sa","com.eg",
  "org.uk","net.au","ac.uk","gov.uk","ne.jp","or.jp",
]);
function caGetETLDplus1(host) {
  if (!host) return "";
  const h = host.replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (CA_TWO_PART_TLDS.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

// GA4 session inactivity default (in seconds). The session resets after 30 min
// with no engaged hits, which is by far the main cause of silent "session reset".
const CA_GA_INACTIVITY_SEC = 30 * 60;

// Format a "hace X" / "en X" relative string from a unix ts (seconds) or ms delta.
function caRelTime(tsSec, now) {
  if (!tsSec) return "—";
  now = now || (Date.now() / 1000);
  const diff = now - tsSec;
  const abs = Math.abs(diff);
  const label = diff >= 0 ? "hace " : "en ";
  let text;
  if (abs < 60) text = Math.round(abs) + " s";
  else if (abs < 3600) text = Math.round(abs / 60) + " min";
  else if (abs < 86400) text = (abs / 3600).toFixed(1) + " h";
  else text = Math.round(abs / 86400) + " d";
  return label + text;
}

function caFormatCountdown(sec) {
  if (sec <= 0) return "expirada";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}

// Validator rules for GA4 tracking cookies against common "session loss" misconfigs.
// Returns array of { severity: 'error'|'warn'|'info', title, detail }.
function caValidateCookieAttrs(cookie, eTLDplus1) {
  const issues = [];
  const isGA = cookie.name === "_ga" || /^_ga_/.test(cookie.name);
  const isGCL = cookie.name === "_gcl_au";
  const isFBP = cookie.name === "_fbp";
  if (!isGA && !isGCL && !isFBP) return issues;

  const dom = (cookie.domain || "").replace(/^\./, "").toLowerCase();
  const expectedDomain = (eTLDplus1 || "").toLowerCase();

  // Domain must cover the eTLD+1 and start with a leading dot so subdomains share it.
  if (expectedDomain) {
    if (dom !== expectedDomain) {
      issues.push({
        severity: "error",
        title: "Domain del cookie no cubre el eTLD+1",
        detail: `Se esperaba ".${expectedDomain}" y está en "${cookie.domain}". Los subdominios no compartirán la cookie y la sesión se romperá al cambiar de subdominio.`,
      });
    } else if (!cookie.domain.startsWith(".")) {
      issues.push({
        severity: "warn",
        title: "Falta el punto inicial en Domain",
        detail: `Domain "${cookie.domain}" restringe la cookie al host exacto. Para compartir con subdominios debería ser ".${expectedDomain}".`,
      });
    }
  }

  // SameSite: strict rompe navegación cross-site. Debe ser Lax o None.
  const ss = (cookie.sameSite || "").toLowerCase();
  if (ss === "strict") {
    issues.push({
      severity: "error",
      title: "SameSite=Strict detectado",
      detail: `La cookie no se envía si el usuario llega desde otro sitio. Usa "Lax" (por defecto) o "None" si necesitas cross-domain.`,
    });
  }
  if (ss === "no_restriction" || ss === "none") {
    if (!cookie.secure) {
      issues.push({
        severity: "error",
        title: "SameSite=None sin Secure",
        detail: "Navegadores modernos descartan cookies con SameSite=None sin el flag Secure (requiere HTTPS).",
      });
    }
  }

  // Session cookie (sin expires) — _ga y _ga_* deben persistir ~2 años.
  if (cookie.session) {
    issues.push({
      severity: "warn",
      title: "Cookie de sesión (sin Expires)",
      detail: `${cookie.name} se pierde al cerrar el navegador. GA4 configura 2 años por defecto — revisa quién la está sobreescribiendo.`,
    });
  }

  return issues;
}

// Parse all attributes we can learn about `_ga` from a live cookie record.
function caExtractClientIdInfo(cookies) {
  const ga = cookies.find(c => c.name === "_ga");
  if (!ga) return null;
  const parts = (ga.value || "").split(".");
  const clientId = parts.length >= 4 ? parts[2] + "." + parts[3] : ga.value;
  const firstVisitSec = parts.length >= 4 ? parseInt(parts[3], 10) : null;
  return {
    clientId,
    firstVisitSec: isNaN(firstVisitSec) ? null : firstVisitSec,
    cookie: ga,
  };
}

// Parse _ga_<MID>. Timestamps ABSOLUTOS (unix seg). El session id ES el inicio de sesión.
//   GS1.1.<sessionId>.<sessionNumber>.<engaged 0|1>.<lastHitTs>.<joinTimer>.<loggedIn>.<hash>
//   GS2.1.s<sessionId>$o<num>$g<engaged>$t<lastHitTs>$j<joinTimer>$l<loggedIn>$h<hash>
// `$g` = session engaged (NO es consent). `$j` = countdown de Google Signals.
function caExtractSessionInfo(cookies) {
  const out = [];
  for (const c of cookies) {
    if (!/^_ga_[A-Z0-9]+$/i.test(c.name)) continue;
    const measurementId = "G-" + c.name.replace(/^_ga_/, "");
    const v = c.value || "";
    const isGS2 = /^GS2\./.test(v);
    const parts = v.split(".");
    let sessStart = null, sessCount = null, engaged = null, lastHitAbsSec = null;
    if (isGS2) {
      const mS = v.match(/\$?s(\d{9,11})/), mO = v.match(/\$o(\d+)/),
            mG = v.match(/\$g([01])/), mT = v.match(/\$t(\d+)/);
      sessStart = mS ? parseInt(mS[1], 10) : null;
      sessCount = mO ? parseInt(mO[1], 10) : null;
      engaged = mG ? mG[1] === "1" : null;
      if (mT) { const raw = parseInt(mT[1], 10); if (raw >= 1000000000) lastHitAbsSec = raw; }
    } else if (parts.length >= 4) {
      const ts = parseInt(parts[2], 10);
      if (ts > 1000000000) sessStart = ts;
      sessCount = parseInt(parts[3], 10) || null;
      if (parts.length >= 5 && /^[01]$/.test(parts[4])) engaged = parts[4] === "1";
      if (parts.length >= 6) { const lh = parseInt(parts[5], 10); if (lh >= 1000000000) lastHitAbsSec = lh; }
    }
    out.push({
      cookieName: c.name, measurementId, raw: v,
      sessionStart: sessStart, sessionCount: sessCount,
      engaged, lastHitAbs: lastHitAbsSec, cookie: c,
    });
  }
  return out;
}

// ---- Extractores de atribución Google Ads ----
// Cookies de click ID: <prefijo>_aw|dc|gb|ag|gs (prefijo por defecto "_gcl", configurable
// en el Conversion Linker) y sus equivalentes server-side FPGCLAW/DC/GB/GS.
// _gcl_au / FPAU es el Conversion Linker (first-party ID), NO un click ID.
const CA_CLICKID_SUFFIXES = {
  aw: { label: "Google Ads (gclid)", param: "gclid" },
  dc: { label: "Search Ads 360 / Display (dclid)", param: "dclid" },
  gb: { label: "wbraid (iOS web-to-app)", param: "wbraid" },
  ag: { label: "gbraid (iOS app-to-web)", param: "gbraid" },
  gs: { label: "gad_source", param: "gad_source" },
};

function caParseClickCookie(c) {
  // GCL.<timestamp>.<clickid>  (aw, dc, gb) · 2.<v>.k…$i<ts>…  (ag, gs)
  const m = (c.value || "").match(/^GCL\.(\d+)\.(.+)$/);
  if (m) return { id: m[2], capturedSec: parseInt(m[1], 10) };
  const m2 = (c.value || "").match(/\$i(\d{9,11})/);
  return { id: c.value || "", capturedSec: m2 ? parseInt(m2[1], 10) : null };
}

function caExtractAdsInfo(cookies) {
  const out = { au: null, ids: {} };
  for (const c of cookies) {
    // Conversion Linker (first-party id)
    if (c.name === "_gcl_au" || c.name === "FPAU") {
      const parts = (c.value || "").split(".");
      const ts = parts.length >= 4 ? parseInt(parts[3], 10) : null;
      out.au = { createdSec: ts && ts > 1000000000 ? ts : null, cookie: c, name: c.name, sgtm: c.name === "FPAU" };
      continue;
    }
    // Server-side: FPGCLAW / FPGCLDC / FPGCLGB / FPGCLGS
    let mm = c.name.match(/^FPGCL(AW|DC|GB|GS)$/i);
    if (mm) {
      const suf = mm[1].toLowerCase();
      if (!out.ids[suf]) out.ids[suf] = Object.assign({ cookie: c, name: c.name, sgtm: true }, caParseClickCookie(c));
      continue;
    }
    // Client-side con prefijo configurable: <prefijo>_aw, _dc, _gb, _ag, _gs
    mm = c.name.match(/^(.+)_(aw|dc|gb|ag|gs)$/i);
    if (mm) {
      const suf = mm[2].toLowerCase();
      const valid = /^GCL\.\d+\./.test(c.value || "") || /^2\.\d+\.k/.test(c.value || "");
      if (valid && !out.ids[suf]) {
        out.ids[suf] = Object.assign({ cookie: c, name: c.name, prefix: mm[1], sgtm: false }, caParseClickCookie(c));
      }
    }
  }
  // compat: .aw sigue disponible como antes
  out.aw = out.ids.aw || null;
  out.gb = out.ids.gb || null;
  return out;
}

// Click IDs vistos en las URLs de navegación del timeline (gclid, wbraid…)
function caClickIdsFromTimeline(timeline) {
  const found = [];
  (timeline || []).forEach(function (e) {
    if ((e.type === "nav" || e.type === "xdomain") && e.url) {
      try {
        const u = new URL(e.url);
        const gclsrc = u.searchParams.get("gclsrc") || "";
        ["gclid", "gbraid", "wbraid", "dclid", "gad_source"].forEach(function (k) {
          const v = u.searchParams.get(k);
          if (!v) return;
          // Cookie que Google debería crear según el parámetro y gclsrc
          let expect = null;
          if (k === "gclid") expect = /^(ds|3p\.ds)$/.test(gclsrc) ? "dc" : "aw";
          else if (k === "dclid") expect = "dc";
          else if (k === "wbraid") expect = "gb";
          else if (k === "gbraid") expect = "ag";
          else if (k === "gad_source") expect = "gs";
          found.push({ param: k, value: v, ts: e.ts, gclsrc: gclsrc, expect: expect });
        });
      } catch (err) {}
    }
  });
  return found;
}

function caTruncId(v) {
  if (!v) return "";
  return v.length > 26 ? v.slice(0, 13) + "…" + v.slice(-8) : v;
}

// ---- Load audit state on tab open ----
async function caLoadState() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
    chrome.runtime.sendMessage({ type: "audit-get-state", tabId: tabId }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.state && resp.state.active) {
        caAuditActive = true;
        caStartBtn.classList.add("hidden");
        caStopBtn.classList.remove("hidden");
        caCheckBtn.classList.remove("hidden");
        caClearBtn.classList.remove("hidden");
        caStatus.textContent = "Auditando";
        caStatus.className = "ca-badge ca-badge-active";
        caInitialSnapshot = resp.state.snapshot;
        caETLDplus1 = resp.state.eTLDplus1 || caGetETLDplus1(resp.state.snapshot?.hostname);
        caLastTimelineTs = 0;
        caTimelineEvents = [];
        caRenderAll(caInitialSnapshot, [], null);
        // Fetch timeline + fresh snapshot in the background
        caPollTimeline();
        caManualCheck();
        caStartPolling();
      } else {
        caStopPolling();
        caAuditActive = false;
        caInitialSnapshot = null;
        caCurrentSnapshot = null;
        caTimelineEvents = [];
        caStartBtn.classList.remove("hidden");
        caStopBtn.classList.add("hidden");
        caCheckBtn.classList.add("hidden");
        caClearBtn.classList.add("hidden");
        caStatus.textContent = "Inactivo";
        caStatus.className = "ca-badge ca-badge-idle";
        caResults.innerHTML = '<div class="dl-empty">Pulsa "Iniciar Audit" para capturar las cookies actuales y monitorizar cambios mientras navegas.</div>';
      }
    });
}

// ---- Start audit ----
async function caStartAudit() {
  // Request the optional `cookies` permission so chrome.cookies.onChanged fires
  // in the service worker. Without it we fall back to snapshot-diff only.
  try {
    const granted = await chrome.permissions.request({ permissions: ["cookies"] });
    if (!granted) {
      caResults.innerHTML = '<div class="dl-empty">Se necesita permiso de cookies para monitorizar cambios en tiempo real. Puedes concederlo y pulsar Iniciar de nuevo.</div>';
      return;
    }
  } catch (e) {}
  // Host perms para inyectar los lectores (conversiones, hits GA4) en la página
  if (!await ensureHostPermissions()) {
    caResults.innerHTML = '<div class="dl-empty">Se necesitan permisos de acceso a la página para capturar conversiones. Concédelos y pulsa Iniciar de nuevo.</div>';
    return;
  }

  const tabId = await getActiveTabId();
  if (!tabId) return;
    caStatus.textContent = "Iniciando...";
    caStatus.className = "ca-badge ca-badge-active";
    chrome.runtime.sendMessage({ type: "audit-start", tabId: tabId }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        caStatus.textContent = "Error";
        caStatus.className = "ca-badge ca-badge-error";
        caResults.innerHTML = '<div class="dl-empty">Error al iniciar audit: ' + (resp?.error || 'desconocido') + '</div>';
        return;
      }
      caAuditActive = true;
      caStartBtn.classList.add("hidden");
      caStopBtn.classList.remove("hidden");
      caCheckBtn.classList.remove("hidden");
      caClearBtn.classList.remove("hidden");
      caStatus.textContent = "Auditando";
      caStatus.className = "ca-badge ca-badge-active";
      caInitialSnapshot = resp.snapshot;
      caETLDplus1 = caGetETLDplus1(resp.snapshot && resp.snapshot.hostname);
      caLastTimelineTs = 0;
      caConvHits = [];
      caLastAlerts = null;
      caRenderAll(resp.snapshot, [], null);
      caStartPolling();
    });
}

// ---- Stop audit ----
async function caStopAudit() {
  caStopPolling();
  const tabId = await getActiveTabId();
  if (!tabId) return;
    chrome.runtime.sendMessage({ type: "audit-stop", tabId: tabId }, () => {
      caAuditActive = false;
      caStartBtn.classList.remove("hidden");
      caStopBtn.classList.add("hidden");
      caCheckBtn.classList.add("hidden");
      caClearBtn.classList.add("hidden");
      caStatus.textContent = "Inactivo";
      caStatus.className = "ca-badge ca-badge-idle";
    });
}

// ---- Clear audit (borrar resultados) ----
async function caClearAudit() {
  caStopPolling();
  const tabId = await getActiveTabId();
  if (!tabId) return;
    chrome.runtime.sendMessage({ type: "audit-stop", tabId: tabId }, () => {
      caAuditActive = false;
      caInitialSnapshot = null;
      caCurrentSnapshot = null;
      caTimelineEvents = [];
      caConvHits = [];
      caLastAlerts = null;
      caStartBtn.classList.remove("hidden");
      caStopBtn.classList.add("hidden");
      caCheckBtn.classList.add("hidden");
      caClearBtn.classList.add("hidden");
      caStatus.textContent = "Inactivo";
      caStatus.className = "ca-badge ca-badge-idle";
      caResults.innerHTML = '<div class="dl-empty">Pulsa "Iniciar Audit" para capturar las cookies actuales y monitorizar cambios mientras navegas.</div>';
    });
}

// ---- Manual check (fetch fresh snapshot + timeline) ----
async function caManualCheck() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
    caCheckBtn.innerHTML = '<svg><use href="#i-clock"/></svg>';
    caFetchConversions(tabId);
    chrome.runtime.sendMessage({ type: "audit-check", tabId: tabId }, (resp) => {
      caCheckBtn.innerHTML = '<svg><use href="#i-refresh"/></svg>';
      if (chrome.runtime.lastError || !resp?.ok) return;
      caCurrentSnapshot = resp.current;
      caRenderAll(caInitialSnapshot, caTimelineEvents, resp.current, resp.alerts);
      caPollTimeline();
    });
}

// ---- Polling: timeline + periodic snapshot refresh + GA4 countdown ----
let caPollCounter = 0;
function caStartPolling() {
  caStopPolling();
  caPollCounter = 0;
  // Poll the timeline every 3s (push notifications handle most updates,
  // this is a safety net for when the service worker sleeps or messages are lost).
  // Every 5th poll (~15s) we also refresh the current snapshot so the GA4
  // panel (client_id, last hit timestamps) stays fresh even without navigation.
  caPollTimer = setInterval(() => {
    if (!caAuditActive) return;
    caPollTimeline();
    caPollCounter++;
    if (caPollCounter >= 5) {
      caPollCounter = 0;
      caManualCheck();
    }
  }, 3000);
  // Tick the countdown every second for the GA4 panel.
  caCountdownTimer = setInterval(() => {
    if (!caAuditActive) return;
    caUpdateCountdowns();
  }, 1000);
}

function caStopPolling() {
  if (caPollTimer) { clearInterval(caPollTimer); caPollTimer = null; }
  if (caCountdownTimer) { clearInterval(caCountdownTimer); caCountdownTimer = null; }
}

async function caPollTimeline() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
    chrome.runtime.sendMessage({
      type: "audit-get-timeline",
      tabId: tabId,
      since: caLastTimelineTs,
    }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) return;
      if (resp.eTLDplus1) caETLDplus1 = resp.eTLDplus1;
      if (resp.items && resp.items.length > 0) {
        caTimelineEvents = caTimelineEvents.concat(resp.items);
        caLastTimelineTs = resp.items[resp.items.length - 1].ts;
        // Re-render to show new events; alerts come from last manual check
        caRenderAll(caInitialSnapshot, caTimelineEvents, caCurrentSnapshot);
      }
    });
}

// Lightweight countdown update — mutates DOM text without a full re-render
function caUpdateCountdowns() {
  if (!caCurrentSnapshot) return;
  const now = Date.now() / 1000;
  document.querySelectorAll("[data-ca-expires-ts]").forEach(el => {
    const tsSec = parseFloat(el.getAttribute("data-ca-expires-ts"));
    if (!tsSec) return;
    const remain = tsSec - now;
    el.textContent = caFormatCountdown(remain);
    el.classList.toggle("ca-countdown-warn", remain > 0 && remain < 300);
    el.classList.toggle("ca-countdown-expired", remain <= 0);
  });
  document.querySelectorAll("[data-ca-since-ts]").forEach(el => {
    const tsSec = parseFloat(el.getAttribute("data-ca-since-ts"));
    if (!tsSec) return;
    el.textContent = caRelTime(tsSec, now);
  });
}

// =============================================
// Cookie Audit — vista simple (banner + sub-pestañas)
// =============================================

let caActiveSubTab = "sesion";
let caLastAlerts = null;
let caShowAllCookies = false;

// Espejo del filtro de background (para la vista de cookies)
function caIsTrackingName(name) {
  if (["_ga", "_gid", "_fbp", "_fbc", "_ttp", "FPID", "ttclid"].indexOf(name) !== -1) return true;
  return /^_ga_[A-Z0-9]+$/.test(name) || /^_gcl_/.test(name) || /^FPGCL/.test(name);
}
let caConvHits = [];               // conversiones (GA4 purchase + Google Ads) vistas en red

// Lee de la página los pings de conversión (GA4 purchase / Google Ads) usando
// las performance entries — sin interceptor y robusto aunque el popup se abra tarde.
function caPageConversionScan() {
  var out = [];
  try {
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].name;
      var u;
      try { u = new URL(name); } catch (e0) { continue; }
      var host = u.hostname, path = u.pathname;
      var isGa4 = path.indexOf("/g/collect") !== -1;
      var isCcm = path.indexOf("/ccm/collect") !== -1;
      // Incluye google.com/pagead/1p-conversion (Safari/Firefox) y pagead2.googlesyndication
      var isAds = /(^|\.)(googleadservices\.com|googleads\.g\.doubleclick\.net|pagead2\.googlesyndication\.com)$/.test(host) ||
                  (/(^|\.)google\.[a-z.]{2,6}$/.test(host) && path.indexOf("/pagead/") !== -1);
      isAds = isAds && /\/pagead\/(1p-)?(view.?through)?conversion\//.test(path);
      if (!isGa4 && !isAds && !isCcm) continue;
      try {
        var ts = Math.round((performance.timeOrigin || 0) + entries[i].startTime);
        if (isGa4) {
          var en = u.searchParams.get("en");
          var val = u.searchParams.get("epn.value");
          if (en !== "purchase" && en !== "refund" && !(val && en)) continue;
          out.push({
            kind: "ga4", url: name, ts: ts, en: en,
            value: val, currency: u.searchParams.get("ep.currency"),
            tid: u.searchParams.get("tid"),
            txid: u.searchParams.get("ep.transaction_id"),
          });
        } else {
          // Solo eventos de conversión reales: llevan conversion label.
          // Los pings sin label son remarketing/config de página — ruido.
          var label = u.searchParams.get("label");
          if (!label) continue;
          var m = path.match(/\/(?:1p-)?(?:view.?through)?conversion\/(\d{6,})/);
          var em = u.searchParams.get("em") || "";
          // Cualquier click ID reconocido por Ads: gclid/gclaw, wbraid/gclgb, gbraid, dclid/gcldc
          var clickParams = ["gclaw", "gclid", "gclgb", "wbraid", "gbraid", "gcldc", "dclid"];
          var clickFound = null;
          for (var ci = 0; ci < clickParams.length; ci++) {
            if (u.searchParams.get(clickParams[ci])) { clickFound = clickParams[ci]; break; }
          }
          out.push({
            kind: "ads", url: name, ts: ts,
            awId: m ? "AW-" + m[1] : null,
            value: u.searchParams.get("value"),
            currency: u.searchParams.get("currency_code"),
            label: label,
            transactionId: u.searchParams.get("oid") || u.searchParams.get("transaction_id"),
            hasClickId: !!clickFound,
            clickIdParam: clickFound,
            enhanced: em.length > 8,
            ccm: isCcm,
          });
        }
      } catch (e2) {}
    }
  } catch (e) {}
  return out;
}

// Pide a la pestaña las conversiones y las acumula (dedupe por URL)
function caFetchConversions(tabId) {
  chrome.scripting.executeScript({ target: { tabId: tabId }, func: caPageConversionScan, world: "MAIN" })
    .then(function (res) {
      var hits = (res && res[0] && res[0].result) || [];
      var seen = new Set(caConvHits.map(function (h) { return h.url; }));
      var added = false;
      hits.forEach(function (h) {
        if (!seen.has(h.url)) { caConvHits.push(h); seen.add(h.url); added = true; }
      });
      if (added && caAuditActive) {
        caRenderAll(caInitialSnapshot, caTimelineEvents, caCurrentSnapshot);
      }
    })
    .catch(function () {});
}

// Importe legible: corrige la basura de coma flotante (173.90999999999997 → 173,91)
function caFormatValue(v, currency) {
  if (v == null || v === "") return null;
  var n = parseFloat(v);
  var txt = isFinite(n)
    ? (Math.round(n * 100) / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })
    : String(v);
  return txt + (currency ? " " + currency : "");
}

// La misma conversión dispara a varios endpoints (googleadservices + doubleclick
// + ccm) casi simultáneamente — se agrupan por label+value+ventana de 3s.
function caGroupConversions(hits) {
  const groups = [];
  hits.forEach(function (h) {
    if (h.kind !== "ads") { groups.push(h); return; }
    const g = groups.find(function (x) {
      return x.kind === "ads" && x.label === h.label &&
             (x.value || "") === (h.value || "") && Math.abs(x.ts - h.ts) < 5000;
    });
    if (!g) {
      groups.push(Object.assign({ endpoints: 1 }, h));
    } else {
      g.endpoints++;
      if (!g.enhanced && h.enhanced) g.enhanced = true;
      if (!g.hasClickId && h.hasClickId) g.hasClickId = true;
      if (!g.awId && h.awId) g.awId = h.awId;
    }
  });
  return groups;
}

// ¿Es ruido? — updates de _ga_* donde sólo cambió el timestamp interno
function caIsNoiseEvent(e) {
  if (e.type !== "cookie") return false;
  if (e.removed || e.oldValue == null) return false; // creada/borrada: siempre relevante
  if (/^_ga_/.test(e.name || "") && e.oldValue && e.newValue) {
    var norm = function (v) { return v.replace(/\$t\d+/g, "$t0").replace(/(\$j)\d*/g, "$j0"); };
    if (norm(e.oldValue) === norm(e.newValue)) return true;
  }
  return false;
}

// La respuesta de un vistazo: ¿la sesión GA4 está bien?
function caComputeStatus(cookies, alerts, timeline) {
  const hasGa = cookies.some(c => c.name === "_ga");
  const hasSess = cookies.some(c => /^_ga_/i.test(c.name));
  const errors = alerts.filter(a => a.type === "error");
  const warns = alerts.filter(a => a.type === "warn");
  const gaLost = timeline.some(e => e.type === "cookie" && e.removed && (e.name === "_ga" || /^_ga_/.test(e.name)));
  const xdBad = timeline.some(e => e.type === "xdomain" && !e.hasLinker && !e.adClick);

  // Problemas de atribución Google Ads
  const ads = caExtractAdsInfo(cookies);
  const clickIds = caClickIdsFromTimeline(timeline);
  const gclLost = timeline.some(e => e.type === "cookie" && e.removed &&
    /^(_\w+_(aw|dc|gb|ag|gs)|FPGCL|FPAU|_gcl_au)$/i.test(e.name || ""));
  // ¿El consentimiento publicitario está denegado? Entonces que no se cree la cookie
  // es el comportamiento DOCUMENTADO de Consent Mode, no un fallo de implementación.
  const adsDenied = !!(lastConsentData && lastConsentData.signals &&
    ((lastConsentData.signals.ad_storage && lastConsentData.signals.ad_storage.current === "denied") ||
     (lastConsentData.signals.ad_user_data && lastConsentData.signals.ad_user_data.current === "denied")));
  const adsProblems = [], adsWarnings = [];
  if (gclLost) adsProblems.push("se ha borrado una cookie de atribución de Ads");
  // Por cada click ID visto, comprobar que existe su cookie esperada
  const missing = [];
  clickIds.forEach(function (f) {
    if (!f.expect) return;
    if (!ads.ids[f.expect]) missing.push(f.param);
  });
  if (missing.length) {
    const uniq = missing.filter((v, i, a) => a.indexOf(v) === i).join(", ");
    if (adsDenied) adsWarnings.push(uniq + " en la URL sin cookie de atribución: el consentimiento publicitario está denegado (comportamiento esperado de Consent Mode)");
    else adsProblems.push(uniq + " en la URL pero no se creó su cookie de atribución");
  }

  const gaProblems = [];
  if (gaLost) gaProblems.push("se ha borrado una cookie de GA4");
  if (xdBad) gaProblems.push("salto cross-domain sin linker (_gl)");
  errors.forEach(a => gaProblems.push(a.title));

  if (gaProblems.length && adsProblems.length) {
    return { cls: "ca-status-err", text: "Sesión y atribución en riesgo", reason: gaProblems[0] + " · " + adsProblems[0] };
  }
  if (gaProblems.length) return { cls: "ca-status-err", text: "Sesión GA4 en riesgo", reason: gaProblems[0] };
  if (adsProblems.length) return { cls: "ca-status-err", text: "Atribución Ads en riesgo", reason: adsProblems[0] };
  if (adsWarnings.length) return { cls: "ca-status-warn", text: "Atribución pendiente de consentimiento", reason: adsWarnings[0] };
  if (warns.length) return { cls: "ca-status-warn", text: "Sesión con avisos", reason: warns[0].title };
  if (hasGa && hasSess) return { cls: "ca-status-ok", text: "Sesión GA4 estable", reason: "" };
  if (hasGa) return { cls: "ca-status-warn", text: "Sin sesión activa aún", reason: "hay _ga pero no _ga_* — interactúa con la web y re-escanea" };
  return { cls: "ca-status-idle", text: "GA4 no detectado", reason: "sin cookie _ga — ¿consent denegado o bloqueador?" };
}

function caRenderAll(initial, timeline, current, alerts) {
  try {
    caRenderAllInner(initial, timeline, current, alerts);
  } catch (e) {
    console.error("[Copilot] Cookie Audit render error:", e);
    caResults.innerHTML =
      '<div class="ca-render-error"><strong>Error al renderizar el audit</strong><br>' +
      escapeHtml(e.message) + '<br><span class="ca-render-error-hint">Recarga la extensión en chrome://extensions y pulsa Iniciar de nuevo. Si persiste, copia este mensaje.</span></div>';
  }
}

function caRenderAllInner(initial, timeline, current, alerts) {
  if (!initial) {
    caResults.innerHTML = '<div class="dl-empty">Snapshot vacío — pulsa el botón de re-escanear o reinicia el audit.</div>';
    return;
  }
  if (alerts != null) caLastAlerts = alerts;
  const effAlerts = caLastAlerts || [];
  const liveCookies = (current && current.cookies) || initial.cookies || [];
  const eTLD = caETLDplus1 || caGetETLDplus1(initial.hostname);
  const tl = (timeline || []).filter(e => !caIsNoiseEvent(e));

  const prevScroll = (caResults.querySelector(".ca-tl2-body") || {}).scrollTop || 0;

  const st = caComputeStatus(liveCookies, effAlerts, tl);
  let html = '<div class="ca-status ' + st.cls + '">' +
    '<span class="ca-status-text">' + escapeHtml(st.text) + '</span>' +
    (st.reason ? '<span class="ca-status-reason">' + escapeHtml(st.reason) + '</span>' : '') +
    '</div>';

  const tabs = [["sesion", "Sesión"], ["cookies", "Cookies"], ["timeline", "Timeline (" + tl.length + ")"]];
  html += '<div class="cm-tabs">' + tabs.map(function (t) {
    return '<button type="button" class="cm-tab' + (caActiveSubTab === t[0] ? " is-active" : "") + '" data-catab="' + t[0] + '">' + t[1] + '</button>';
  }).join("") + '</div>';

  if (caActiveSubTab === "sesion") html += caRenderSesion(liveCookies, effAlerts, tl);
  else if (caActiveSubTab === "cookies") html += caRenderCookies(initial, liveCookies, eTLD);
  else html += caRenderTimeline2(tl);

  caResults.innerHTML = html;
  const tb = caResults.querySelector(".ca-tl2-body");
  if (tb && prevScroll) tb.scrollTop = prevScroll;
  caUpdateCountdowns();
}

// --- Sub-pestaña Sesión: client_id + sesiones + alertas reales ---
function caRenderSesion(cookies, alerts, timeline) {
  const cid = caExtractClientIdInfo(cookies);
  const sessions = caExtractSessionInfo(cookies);
  const nowSec = Date.now() / 1000;
  let html = '<div class="ca-sec-title">Sesión GA4</div>';
  html += '<div class="ca-cards">';

  html += '<div class="ca-card">';
  html += '<span class="ca-card-label">Client ID (_ga)</span>';
  if (cid) {
    html += '<span class="ca-card-value ca-mono">' + escapeHtml(cid.clientId) + '</span>';
    if (cid.firstVisitSec) {
      html += '<span class="ca-card-meta">primera visita <span data-ca-since-ts="' + cid.firstVisitSec + '">' + caRelTime(cid.firstVisitSec, nowSec) + '</span></span>';
    }
  } else {
    html += '<span class="ca-card-value ca-muted">no detectado</span>';
  }
  html += '</div>';

  // Activas primero (tarjeta completa); expiradas o sin datos, plegadas al final.
  const fresh = [], stale = [];
  sessions.forEach(function (sess) {
    const lastHit = sess.lastHitAbs || sess.sessionStart;
    const expiresAtSec = lastHit ? lastHit + CA_GA_INACTIVITY_SEC : null;
    if (expiresAtSec && expiresAtSec > nowSec) fresh.push(sess); else stale.push(sess);
  });
  fresh.sort(function (a, b) { return (b.lastHitAbs || b.sessionStart || 0) - (a.lastHitAbs || a.sessionStart || 0); });

  if (sessions.length === 0) {
    html += '<div class="ca-card"><span class="ca-card-label">Sesión GA4</span><span class="ca-card-value ca-muted">sin cookie _ga_* todavía</span></div>';
  } else if (fresh.length === 0) {
    html += '<div class="ca-card"><span class="ca-card-label">Sesión GA4</span><span class="ca-card-value ca-muted">ninguna sesión activa</span><span class="ca-card-meta">todas las _ga_* del dominio están expiradas — interactúa con la web y re-escanea</span></div>';
  }
  fresh.forEach(function (sess) {
    const lastHit = sess.lastHitAbs || sess.sessionStart;
    const expiresAtSec = lastHit + CA_GA_INACTIVITY_SEC;
    const remain = expiresAtSec - nowSec;
    const cls = remain < 300 ? "ca-countdown-warn" : "";
    html += '<div class="ca-card">';
    html += '<span class="ca-card-label">' + escapeHtml(sess.measurementId) + (sess.sessionCount ? ' · sesión #' + sess.sessionCount : '') + '</span>';
    html += '<span class="ca-card-value"><span class="ca-countdown ' + cls + '" data-ca-expires-ts="' + expiresAtSec + '">' + caFormatCountdown(remain) + '</span> <span class="ca-card-meta">para expirar por inactividad</span></span>';
    const bits = [];
    if (sess.sessionStart) bits.push('inicio <span data-ca-since-ts="' + sess.sessionStart + '">' + caRelTime(sess.sessionStart, nowSec) + '</span>');
    if (sess.lastHitAbs) bits.push('último hit <span data-ca-since-ts="' + sess.lastHitAbs + '">' + caRelTime(sess.lastHitAbs, nowSec) + '</span>');
    if (bits.length) html += '<span class="ca-card-meta">' + bits.join(" · ") + '</span>';
    html += '</div>';
  });
  html += '</div>';

  if (stale.length > 0) {
    html += '<details class="ca-stale"><summary>' + stale.length + ' propiedad' + (stale.length > 1 ? 'es' : '') + ' sin sesión activa (expiradas)</summary>';
    stale.forEach(function (sess) {
      const lastHit = sess.lastHitAbs || sess.sessionStart;
      html += '<div class="ca-stale-row"><span class="ca-mono">' + escapeHtml(sess.measurementId) + '</span>' +
        (sess.sessionCount ? '<span>sesión #' + sess.sessionCount + '</span>' : '<span></span>') +
        '<span>' + (lastHit ? 'último hit ' + caRelTime(lastHit, nowSec) : 'sin datos') + '</span></div>';
    });
    html += '</details>';
  }

  // --- Atribución Google Ads ---
  const ads = caExtractAdsInfo(cookies);
  const clickIds = caClickIdsFromTimeline(timeline || []);
  const sufKeys = Object.keys(ads.ids);
  const adsDeniedUi = !!(lastConsentData && lastConsentData.signals &&
    ((lastConsentData.signals.ad_storage && lastConsentData.signals.ad_storage.current === "denied") ||
     (lastConsentData.signals.ad_user_data && lastConsentData.signals.ad_user_data.current === "denied")));
  html += '<div class="ca-sec-title">Atribución Google Ads</div>';
  html += '<div class="ca-cards">';

  if (!sufKeys.length && !ads.au && !clickIds.length) {
    html += '<div class="ca-card"><span class="ca-card-label">Google Ads</span>' +
      '<span class="ca-card-value ca-muted">sin señales</span>' +
      '<span class="ca-card-meta">para probar: aterriza con <span class="ca-mono">?gclid=TEST123</span> (o wbraid/gbraid/dclid) y comprueba que se crea la cookie de atribución</span></div>';
  } else {
    const missUniq = [];
    clickIds.forEach(function (f) {
      if (!f.expect || ads.ids[f.expect]) return;
      if (!missUniq.some(function (x) { return x.param === f.param; })) missUniq.push(f);
    });
    missUniq.forEach(function (f) {
      const expName = (CA_CLICKID_SUFFIXES[f.expect] || {}).label || f.expect;
      html += '<div class="ca-card ' + (adsDeniedUi ? "ca-card-warn" : "ca-card-err") + '">' +
        '<span class="ca-card-label">Click ID (' + escapeHtml(f.param) + ')' + (f.gclsrc ? ' · gclsrc=' + escapeHtml(f.gclsrc) : '') + '</span>' +
        '<span class="ca-card-value ca-mono">' + escapeHtml(caTruncId(f.value)) + '</span>' +
        '<span class="ca-card-meta">' + (adsDeniedUi
          ? 'visto en la URL y aún sin cookie <span class="ca-mono">_gcl_' + f.expect + '</span> — el consentimiento publicitario está denegado: es el comportamiento esperado de Consent Mode. Acepta el banner y re-escanea.'
          : 'visto en la URL pero NO se guardó en <span class="ca-mono">_gcl_' + f.expect + '</span> (' + escapeHtml(expName) + ') — la conversión no se atribuirá. Revisa el Conversion Linker.') +
        '</span></div>';
    });
    sufKeys.forEach(function (suf) {
      const info = ads.ids[suf];
      const meta = CA_CLICKID_SUFFIXES[suf] || { label: suf };
      const seen = clickIds.filter(function (f) { return f.expect === suf; }).map(function (f) { return f.value; });
      const uniq = seen.filter(function (v, i2, a) { return a.indexOf(v) === i2; });
      let match = "";
      if (uniq.length) {
        match = uniq.indexOf(info.id) !== -1
          ? (uniq.length > 1 ? " · coincide con un aterrizaje ✓ (" + uniq.length + " distintos en esta sesión)" : " · coincide con la URL ✓")
          : " · no coincide con ningún click ID visto en este audit ⚠";
      }
      const bits = [];
      if (info.capturedSec) bits.push('capturado <span data-ca-since-ts="' + info.capturedSec + '">' + caRelTime(info.capturedSec, nowSec) + '</span>');
      if (info.cookie.expirationDate) bits.push("expira en " + formatCookieExpiry(info.cookie.expirationDate));
      if (info.sgtm) bits.push("server-side");
      html += '<div class="ca-card' + (match.indexOf("⚠") !== -1 ? " ca-card-warn" : "") + '">' +
        '<span class="ca-card-label">' + escapeHtml(meta.label) + ' · ' + escapeHtml(info.name) + '</span>' +
        '<span class="ca-card-value ca-mono" title="' + escapeHtml(info.id) + '">' + escapeHtml(caTruncId(info.id)) + '</span>' +
        '<span class="ca-card-meta">' + bits.join(" · ") + escapeHtml(match) + '</span></div>';
    });
    if (ads.au) {
      const auBits = [];
      if (ads.au.createdSec) auBits.push('creado <span data-ca-since-ts="' + ads.au.createdSec + '">' + caRelTime(ads.au.createdSec, nowSec) + '</span>');
      if (ads.au.cookie.expirationDate) auBits.push("expira en " + formatCookieExpiry(ads.au.cookie.expirationDate));
      if (ads.au.sgtm) auBits.push("server-side");
      html += '<div class="ca-card"><span class="ca-card-label">Conversion Linker · ' + escapeHtml(ads.au.name) + '</span>' +
        '<span class="ca-card-value">activo</span>' +
        (auBits.length ? '<span class="ca-card-meta">' + auBits.join(" · ") + '</span>' : '') + '</div>';
    } else if (sufKeys.length || clickIds.length) {
      html += '<div class="ca-card ca-card-warn"><span class="ca-card-label">Conversion Linker (_gcl_au)</span>' +
        '<span class="ca-card-value ca-muted">no detectado</span>' +
        '<span class="ca-card-meta">es la cookie first-party que enlaza el clic con la conversión — revisa el tag Conversion Linker en GTM</span></div>';
    }
  }
  html += '</div>';

  // --- Conversiones (GA4 purchase + objetivos de Google Ads con label) ---
  html += '<div class="ca-sec-title">Conversiones</div>';
  var convGroups = caGroupConversions(caConvHits);
  if (convGroups.length === 0) {
    html += '<div class="ca-cards"><div class="ca-card"><span class="ca-card-label">Conversiones</span>' +
      '<span class="ca-card-value ca-muted">aún ninguna</span>' +
      '<span class="ca-card-meta">completa una compra u objetivo — aquí verás cada conversión con su value, currency, gclid y enhanced conversions</span></div></div>';
  } else {
    html += '<div class="ca-conv-list">';
    convGroups.slice().reverse().forEach(function (h) {
      var time = new Date(h.ts).toLocaleTimeString("es-ES", { hour12: false });
      var noValue = !h.value;
      var fmtVal = caFormatValue(h.value, h.currency);
      var rawTip = (h.value ? "value=" + h.value + " " : "") + h.url.slice(0, 280);
      if (h.kind === "ga4") {
        html += '<div class="ca-conv-row' + (noValue ? " ca-conv-warn" : "") + '" title="' + escapeHtml(rawTip) + '">' +
          '<span class="ca-tl2-time">' + time + '</span>' +
          '<span class="ca-conv-badge ca-conv-ga4">GA4 ' + escapeHtml(h.en || "purchase") + '</span>' +
          '<span class="ca-conv-value">' + (fmtVal ? escapeHtml(fmtVal) : "sin value ⚠") + '</span>' +
          '<div class="ca-conv-l2">' +
          (h.tid ? '<span class="ca-conv-meta">' + escapeHtml(h.tid) + '</span>' : '') +
          (h.txid ? '<span class="ca-conv-meta ca-mono" title="transaction_id">' + escapeHtml(h.txid) + '</span>' : '') +
          '</div>' +
          '</div>';
      } else {
        html += '<div class="ca-conv-row' + (noValue ? " ca-conv-warn" : "") + '" title="' + escapeHtml(rawTip) + '">' +
          '<span class="ca-tl2-time">' + time + '</span>' +
          '<span class="ca-conv-badge ca-conv-ads">Google Ads</span>' +
          '<span class="ca-conv-value">' + (fmtVal ? escapeHtml(fmtVal) : "sin value") + '</span>' +
          '<div class="ca-conv-l2">' +
          '<span class="ca-conv-meta">' + escapeHtml(h.awId || "AW-?") + '</span>' +
          '<span class="ca-conv-meta ca-mono" title="conversion label — identifica el objetivo en Google Ads">' + escapeHtml(h.label || "") + '</span>' +
          '<span class="ca-conv-meta" title="' + (h.hasClickId ? "click ID presente: " + h.clickIdParam : "la conversión no lleva ningún click ID (gclid/wbraid/gbraid/dclid)") + '">' + (h.hasClickId ? (h.clickIdParam || "click ID") + " ✓" : "sin click ID") + '</span>' +
          (h.transactionId ? '<span class="ca-conv-meta ca-mono" title="transaction_id / oid — usado para deduplicar">' + escapeHtml(h.transactionId) + '</span>' : '') +
          '<span class="ca-conv-ec' + (h.enhanced ? "" : " ca-conv-ec-off") + '">' + (h.enhanced ? "enhanced ✓" : "sin enhanced") + '</span>' +
          (h.endpoints > 1 ? '<span class="ca-conv-meta" title="endpoints que recibieron este mismo objetivo">×' + h.endpoints + '</span>' : '') +
          '</div>' +
          '</div>';
      }
    });
    html += '</div>';
  }

  const relevant = (alerts || []).filter(a => a.type === "error" || a.type === "warn");
  if (relevant.length) {
    html += '<div class="ca-alerts">';
    relevant.forEach(function (a) {
      const cls = a.type === "error" ? "ca-alert-error" : "ca-alert-warn";
      html += '<div class="ca-alert ' + cls + '"><div class="ca-alert-title">' + escapeHtml(a.title) + '</div><div class="ca-alert-detail">' + escapeHtml(a.detail) + '</div></div>';
    });
    html += '</div>';
  }
  return html;
}

// --- Sub-pestaña Cookies: tabla actual + perdidas; problemas como ⚠ con tooltip ---
function caRenderCookies(initial, cookies, eTLDplus1) {
  // "ver todas" usa la lista completa del snapshot actual (o inicial como fallback)
  const source = caShowAllCookies
    ? ((caCurrentSnapshot && caCurrentSnapshot.allCookies) || initial.allCookies || cookies)
    : cookies;
  const currentNames = new Set(source.map(c => c.name));
  const lost = (initial.cookies || []).filter(c => !currentNames.has(c.name));
  const total = ((caCurrentSnapshot && caCurrentSnapshot.allCookies) || initial.allCookies || []).length;
  let html = '<div class="ca-ck-bar">' +
    '<span>' + source.length + ' cookie' + (source.length !== 1 ? 's' : '') + (caShowAllCookies ? '' : ' de tracking') + '</span>' +
    (total > 0 ? '<button type="button" class="ca-ck-toggle" data-catoggle>' + (caShowAllCookies ? 'ver solo tracking' : 'ver todas (' + total + ')') + '</button>' : '') +
    '</div>';
  html += '<div class="ca-ck-table">';
  html += '<div class="ca-ck-row ca-ck-head"><span>Cookie</span><span>Dominio</span><span>Expira</span><span></span></div>';
  lost.forEach(function (c) {
    html += '<div class="ca-ck-row ca-ck-lost" title="Estaba al iniciar el audit y ya no existe">' +
      '<span class="ca-mono">' + escapeHtml(c.name) + '</span>' +
      '<span>' + escapeHtml(c.domain || "") + '</span>' +
      '<span>—</span>' +
      '<span class="ca-ck-flag ca-ck-flag-lost">perdida</span></div>';
  });
  source.forEach(function (c) {
    const issues = caValidateCookieAttrs(c, eTLDplus1).filter(i => i.severity !== "info");
    let tip = "valor: " + truncateValue(c.value || "");
    if (c.sameSite) tip += " · SameSite=" + c.sameSite;
    if (c.secure) tip += " · Secure";
    issues.forEach(function (i) { tip += "\n⚠ " + i.title + ": " + i.detail; });
    html += '<div class="ca-ck-row" title="' + escapeHtml(tip) + '">' +
      '<span class="ca-mono">' + escapeHtml(c.name) + '</span>' +
      '<span>' + escapeHtml(c.domain || "") + '</span>' +
      '<span>' + escapeHtml(formatCookieExpiry(c.expirationDate)) + '</span>' +
      (issues.length
        ? '<span class="ca-ck-flag ca-ck-flag-warn">⚠ ' + issues.length + '</span>'
        : '<span class="ca-ck-flag ca-ck-flag-ok">✓</span>') +
      '</div>';
  });
  html += '</div>';
  return html;
}

// --- Sub-pestaña Timeline: una línea por evento, diff en tooltip ---
function caRenderTimeline2(events) {
  if (!events.length) {
    return '<div class="dl-empty">Aún no hay eventos. Navega por la web con el audit activo y aparecerán aquí.</div>';
  }
  let html = '<div class="ca-tl2-body">';
  events.slice().reverse().forEach(function (e) { html += caTl2Row(e); });
  html += '</div>';
  return html;
}

function caTl2Row(e) {
  const time = new Date(e.ts).toLocaleTimeString("es-ES", { hour12: false });
  let chip = "", chipCls = "ca-tl2-mut", main = "", extra = "", rowCls = "", tip = "";
  if (e.type === "nav") {
    chip = e.initial ? "inicio" : "nav"; chipCls = "ca-tl2-nav";
    main = e.hostname || "";
    const adm = e.url && e.url.match(/[?&](gclid|gbraid|wbraid|dclid)=([^&#]+)/);
    if (adm) {
      extra = "aterrizaje de anuncio (" + adm[1] + ")";
      rowCls += " ca-tl2-adclick";
      tip = adm[1] + "=" + adm[2];
    }
  } else if (e.type === "xdomain") {
    if (e.adClick) {
      chip = "ad click"; chipCls = "ca-tl2-ok";
      main = (e.fromETLD || "") + " → " + (e.toETLD || "");
      extra = "aterrizaje de anuncio (" + (e.clickParam || "gclid") + ") — audit re-anclado al destino";
      rowCls = " ca-tl2-adclick";
    } else {
      chip = e.hasLinker ? "x-dom ✓" : "x-dom ✕";
      chipCls = e.hasLinker ? "ca-tl2-ok" : "ca-tl2-err";
      main = (e.fromETLD || "") + " → " + (e.toETLD || "");
      if (!e.hasLinker) { extra = "sin _gl — el client_id no viaja"; rowCls = " ca-tl2-critical"; }
    }
  } else if (e.type === "cookie") {
    const action = e.removed ? "borrada" : (e.oldValue == null ? "creada" : "cambiada");
    chip = action;
    chipCls = e.removed ? "ca-tl2-err" : (e.oldValue == null ? "ca-tl2-ok" : "ca-tl2-mut");
    main = e.name || "";
    if (e.removed && (e.name === "_ga" || /^_ga_/.test(e.name))) rowCls = " ca-tl2-critical";
    if (e.removed) {
      extra = ({ explicit: "borrada por la web", evicted: "desalojada por el navegador", expired: "expirada" })[e.cause] || "";
    }
    tip = (e.oldValue ? truncateValue(e.oldValue) : "∅") + " → " + (e.newValue ? truncateValue(e.newValue) : "∅");
  } else {
    chip = e.type || "?";
  }
  return '<div class="ca-tl2-row' + rowCls + '"' + (tip ? ' title="' + escapeHtml(tip) + '"' : '') + '>' +
    '<span class="ca-tl2-time">' + time + '</span>' +
    '<span class="ca-tl2-chip ' + chipCls + '">' + escapeHtml(chip) + '</span>' +
    '<span class="ca-tl2-main ca-mono">' + escapeHtml(main) + '</span>' +
    (extra ? '<span class="ca-tl2-extra">' + escapeHtml(extra) + '</span>' : '') +
    '</div>';
}

// ---- Help popover content: cookie fundamentals + glossary + how to read the audit ----
const CA_HELP_CONTENT = `
  <section>
    <h4>¿Qué es una cookie?</h4>
    <p>Un pequeño archivo de texto que el navegador guarda por dominio. Tiene un <strong>nombre</strong>, un <strong>valor</strong> y una serie de <strong>atributos</strong> que deciden cuándo se envía y cuándo se destruye.</p>
  </section>

  <section>
    <h4>Atributos clave (y por qué importan para la sesión)</h4>
    <ul>
      <li><strong>Domain</strong>: qué hosts reciben la cookie. <code>.marca.com</code> (con punto inicial) la comparte con subdominios; <code>www.marca.com</code> (sin punto) la deja pegada a ese host y <em>la sesión se rompe al saltar de subdominio</em>.</li>
      <li><strong>SameSite</strong>: controla el envío cross-site.
        <code>Lax</code> (defecto) sirve en navegación normal;
        <code>Strict</code> NO envía la cookie si vienes de otro sitio (típica causa de "se pierde la sesión");
        <code>None</code> la envía siempre pero <em>requiere</em> <code>Secure</code>.</li>
      <li><strong>Secure</strong>: solo se envía por HTTPS.</li>
      <li><strong>HttpOnly</strong>: no accesible desde JavaScript (<code>document.cookie</code>).</li>
      <li><strong>Expires / Max-Age</strong>: cuándo caduca. Sin fecha = cookie de sesión (muere al cerrar el navegador).</li>
    </ul>
  </section>

  <section>
    <h4>Cookies monitorizadas</h4>
    <dl class="ca-help-dl">
      <dt><code>_ga</code></dt>
      <dd>Client ID de GA4. Identifica al usuario. Debe ser estable ~2 años. Si cambia, GA4 cuenta al usuario como nuevo.</dd>

      <dt><code>_ga_&lt;ID&gt;</code></dt>
      <dd>Cookie de sesión de GA4 (una por propiedad). Contiene <code>session_start</code>, <code>session_count</code> y el último hit. Expira por inactividad a los 30 min por defecto.</dd>

      <dt><code>_gcl_aw</code>, <code>_gcl_dc</code>, <code>_gcl_gb</code>, <code>_gcl_ag</code>, <code>_gcl_gs</code></dt>
      <dd>Cookies de click ID de Google Ads (90 días, formato <code>GCL.&lt;ts&gt;.&lt;id&gt;</code>). Se crean al aterrizar con <code>?gclid=</code> (→ <code>_aw</code>, o <code>_dc</code> si <code>gclsrc=ds</code>), <code>?dclid=</code> (→ <code>_dc</code>), <code>?wbraid=</code> (→ <code>_gb</code>), <code>?gbraid=</code> (→ <code>_ag</code>) o <code>?gad_source=</code> (→ <code>_gs</code>). El prefijo <code>_gcl</code> es configurable en el Conversion Linker, y con server-side GTM son <code>FPGCLAW</code>/<code>FPGCLDC</code>/… Si no se crean, la conversión no se atribuye — salvo que el consentimiento publicitario esté denegado, donde es el comportamiento esperado.</dd>

      <dt><code>_gcl_au</code></dt>
      <dd>Conversion Linker de Google Ads. 90 días. Permite atribuir conversiones entre dominios.</dd>

      <dt><code>_fbp</code>, <code>_fbc</code></dt>
      <dd>Meta Pixel — ID del navegador y del clic. Sin ellas no atribuyes conversiones de Facebook Ads.</dd>

      <dt><code>_ttp</code>, <code>ttclid</code></dt>
      <dd>TikTok Pixel.</dd>

      <dt><code>FPID</code></dt>
      <dd>First-Party ID de server-side GTM. Cookie 1st-party inmune a ITP.</dd>
    </dl>
  </section>

  <section>
    <h4>Por qué se rompe una sesión (causas típicas)</h4>
    <ol>
      <li><strong>Salto cross-domain sin <code>_gl=</code></strong>: ir de <code>marca.com</code> a otro dominio (checkout, app, etc.) sin el parámetro Google Linker. El cliente se convierte en nuevo usuario.</li>
      <li><strong><code>SameSite=Strict</code></strong> en <code>_ga</code>/<code>_ga_*</code>. Típico cuando redirige desde un subdominio que cambia el origin.</li>
      <li><strong>Domain sin punto inicial</strong>. La cookie queda host-only y se pierde al saltar a <code>checkout.marca.com</code>.</li>
      <li><strong>Inactividad &gt;30 min</strong>: GA4 abre nueva sesión automáticamente.</li>
      <li><strong>Script que hace <code>document.cookie=...;expires=0</code></strong>: muchos "clear all cookies on logout" barren más de la cuenta.</li>
      <li><strong>CMP que revoca consentimiento</strong>: al denegar, GA4 borra o restringe las cookies.</li>
    </ol>
  </section>

  <section>
    <h4>Cómo leer el Timeline</h4>
    <ul>
      <li><strong>creada</strong>: es la primera vez que se ve la cookie.</li>
      <li><strong>actualizada</strong>: cambió su valor de forma relevante (<em>session_start</em> o <em>session_count</em> en GA4).</li>
      <li><strong>eliminada</strong>: desapareció. Mira la causa:
        <code>explicit</code> = la web la borró;
        <code>evicted</code> = el navegador la desalojó (exceso de cookies);
        <code>expired</code> = llegó a su fecha de caducidad.</li>
      <li><strong>Salto cross-domain SIN linker</strong>: alerta en rojo — el client_id no viajó al otro dominio.</li>
    </ul>
  </section>
`;

// ---- Helper: format cookie expiry as human-readable duration ----
function formatCookieExpiry(expirationDate) {
  if (!expirationDate) return "Sesión";
  const now = Date.now() / 1000;
  const diff = expirationDate - now;
  if (diff <= 0) return "Expirada";
  if (diff < 3600) return Math.round(diff / 60) + " min";
  if (diff < 86400) return Math.round(diff / 3600) + " h";
  if (diff < 86400 * 30) return Math.round(diff / 86400) + " d";
  if (diff < 86400 * 365) return Math.round(diff / (86400 * 30)) + " meses";
  const years = diff / (86400 * 365);
  return years >= 1.9 ? Math.round(years) + " años" : (years * 12).toFixed(0) + " meses";
}

// ---- Helper: truncate long cookie values ----
function truncateValue(val) {
  if (!val) return '';
  return val.length > 40 ? val.substring(0, 37) + '...' : val;
}

// ---- Listen for push updates from background ----
chrome.runtime.onMessage.addListener((msg) => {
  if (!caAuditActive) return;
  if (msg.type === "audit-navigation") {
    caManualCheck();
  } else if (msg.type === "audit-timeline-event") {
    if (!msg.event) return;
    caTimelineEvents.push(msg.event);
    if (msg.event.ts > caLastTimelineTs) caLastTimelineTs = msg.event.ts;
    caRenderAll(caInitialSnapshot, caTimelineEvents, caCurrentSnapshot);
    // Refresh the GA4 panel when a _ga* cookie event arrives so the
    // "client_id / session" view stays in sync with reality.
    const e = msg.event;
    if (e.type === "cookie" && (e.name === "_ga" || /^_ga_/.test(e.name))) {
      caManualCheck();
    }
  }
});

// ---- Event listeners ----
caStartBtn.addEventListener("click", caStartAudit);
caStopBtn.addEventListener("click", caStopAudit);
caCheckBtn.addEventListener("click", caManualCheck);
caClearBtn.addEventListener("click", caClearAudit);

// Sub-pestañas del audit (delegado: el contenido se re-renderiza entero)
caResults.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-catoggle]");
  if (toggle) {
    caShowAllCookies = !caShowAllCookies;
    caRenderAll(caInitialSnapshot, caTimelineEvents, caCurrentSnapshot);
    return;
  }
  const btn = e.target.closest("[data-catab]");
  if (!btn) return;
  caActiveSubTab = btn.dataset.catab;
  caRenderAll(caInitialSnapshot, caTimelineEvents, caCurrentSnapshot);
});

// Help popover (educational glossary about cookies and the audit)
(function initCookieAuditHelp() {
  const btn = document.getElementById("caHelpBtn");
  const popover = document.getElementById("caHelpPopover");
  const body = document.getElementById("caHelpBody");
  const closeBtn = document.getElementById("caHelpClose");
  if (!btn || !popover || !body) return;

  let rendered = false;
  const render = () => {
    if (rendered) return;
    body.innerHTML = CA_HELP_CONTENT;
    rendered = true;
  };
  const open = () => {
    render();
    popover.classList.remove("hidden");
  };
  const close = () => popover.classList.add("hidden");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.classList.contains("hidden") ? open() : close();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);
  document.addEventListener("click", (e) => {
    if (popover.classList.contains("hidden")) return;
    if (popover.contains(e.target) || btn.contains(e.target)) return;
    close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popover.classList.contains("hidden")) close();
  });
})();


// =============================================
// TAB: Lab — Inject & Block
// =============================================

const labBlockUrl = document.getElementById("labBlockUrl");
const labBlockAddBtn = document.getElementById("labBlockAddBtn");
const labBlockList = document.getElementById("labBlockList");
const labGtmEnabled = document.getElementById("labGtmEnabled");
const labGtmId = document.getElementById("labGtmId");
const labDlEnabled = document.getElementById("labDlEnabled");
const labDlCode = document.getElementById("labDlCode");
const labDlPushBtn = document.getElementById("labDlPushBtn");
const labSaveBtn = document.getElementById("labSaveBtn");
const labClearBtn = document.getElementById("labClearBtn");
const labStatus = document.getElementById("labStatus");
const labBlocksBadge = document.getElementById("labBlocksBadge");

let labBlocks = []; // { id, pattern, enabled }
let labNextRuleId = 1000;

// ---- Reflect feature state visually on cards ----
function updateLabCardStates() {
  const setActive = (feature, isActive) => {
    const card = document.querySelector(`.lab-card[data-lab-feature="${feature}"]`);
    if (card) card.classList.toggle("is-active", !!isActive);
  };
  setActive("gtm", labGtmEnabled && labGtmEnabled.checked);
  setActive("datalayer", labDlEnabled && labDlEnabled.checked);

  // Blocks card is active if any enabled block exists
  const activeBlocks = labBlocks.filter(b => b.enabled).length;
  setActive("blocks", activeBlocks > 0);

  // Update badge
  if (labBlocksBadge) {
    if (activeBlocks > 0) {
      labBlocksBadge.textContent = String(activeBlocks);
      labBlocksBadge.hidden = false;
    } else {
      labBlocksBadge.hidden = true;
    }
  }
}

// ---- Load saved config ----
async function labLoadConfig() {
  const { labConfig } = await chrome.storage.local.get("labConfig");
  if (!labConfig) {
    renderLabBlocks();
    return;
  }

  labBlocks = labConfig.blocks || [];
  labNextRuleId = labConfig.nextRuleId || 1000;

  if (labConfig.gtm) {
    labGtmEnabled.checked = labConfig.gtm.enabled || false;
    labGtmId.value = labConfig.gtm.containerId || "";
  }
  if (labConfig.dataLayer) {
    labDlEnabled.checked = labConfig.dataLayer.enabled || false;
    labDlCode.value = labConfig.dataLayer.code || "";
  }

  renderLabBlocks();
  updateLabCardStates();
}

// ---- Save config ----
async function labSaveConfig() {
  const config = {
    blocks: labBlocks,
    nextRuleId: labNextRuleId,
    gtm: {
      enabled: labGtmEnabled.checked,
      containerId: labGtmId.value.trim(),
    },
    dataLayer: {
      enabled: labDlEnabled.checked,
      code: labDlCode.value.trim(),
    },
  };
  await chrome.storage.local.set({ labConfig: config });
}

// ---- Block management ----
function labAddBlock(pattern) {
  // Don't add duplicates
  if (labBlocks.some(b => b.pattern === pattern)) return;
  const id = labNextRuleId++;
  labBlocks.push({ id, pattern, enabled: true });
  renderLabBlocks();
}

function labRemoveBlock(id) {
  labBlocks = labBlocks.filter(b => b.id !== id);
  renderLabBlocks();
}

function labToggleBlock(id) {
  const block = labBlocks.find(b => b.id === id);
  if (block) block.enabled = !block.enabled;
  renderLabBlocks();
}

function renderLabBlocks() {
  if (!labBlockList) return;
  updateLabCardStates();
  if (labBlocks.length === 0) {
    labBlockList.innerHTML = '<div class="lab-block-empty">Aún no hay reglas. Añade desde los atajos o escribe un patrón.</div>';
    return;
  }
  labBlockList.innerHTML = labBlocks.map(b => `
    <div class="lab-block-item ${b.enabled ? "" : "lab-block-disabled"}">
      <label class="lab-block-toggle">
        <input type="checkbox" ${b.enabled ? "checked" : ""} data-block-id="${b.id}">
      </label>
      <span class="lab-block-pattern">${escapeHtml(b.pattern)}</span>
      <button class="lab-block-remove" data-block-id="${b.id}" title="Eliminar"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>
    </div>
  `).join("");

  labBlockList.querySelectorAll("input[data-block-id]").forEach(cb => {
    cb.addEventListener("change", () => labToggleBlock(parseInt(cb.dataset.blockId)));
  });
  labBlockList.querySelectorAll(".lab-block-remove").forEach(btn => {
    btn.addEventListener("click", () => labRemoveBlock(parseInt(btn.dataset.blockId)));
  });
}

// ---- Apply blocking rules via declarativeNetRequest ----
async function labApplyBlockRules() {
  // Guard: declarativeNetRequest may not be available if extension wasn't reloaded after manifest change
  if (!chrome.declarativeNetRequest) {
    labShowStatus("Recarga la extensión en chrome://extensions para activar el bloqueo de requests");
    return;
  }

  try {
    // Remove all existing lab rules (IDs >= 1000)
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const labRuleIds = existingRules.filter(r => r.id >= 1000).map(r => r.id);

    // Build new rules from enabled blocks
    const addRules = labBlocks.filter(b => b.enabled).map(b => ({
      id: b.id,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: b.pattern,
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "stylesheet", "font", "media", "ping", "other"],
      },
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: labRuleIds,
      addRules: addRules,
    });
  } catch (err) {
    console.error("Lab — Error applying block rules:", err);
    labShowStatus("Error en bloqueo: " + err.message);
  }
}

// ---- Save & Reload ----
async function labSaveAndReload() {
  if (!await ensureHostPermissions()) {
    labShowStatus("Se necesitan permisos de acceso a páginas web");
    return;
  }

  await labSaveConfig();
  await labApplyBlockRules();

  // Verify rules were applied
  if (chrome.declarativeNetRequest) {
    const applied = await chrome.declarativeNetRequest.getDynamicRules();
    const labRules = applied.filter(r => r.id >= 1000);
    console.log("[Lab] Reglas de bloqueo activas:", labRules);
    if (labRules.length > 0) {
      labShowStatus(`${labRules.length} regla${labRules.length > 1 ? "s" : ""} activa${labRules.length > 1 ? "s" : ""}. Recargando...`);
    } else {
      labShowStatus("Guardado. Recargando página...");
    }
  } else {
    labShowStatus("Guardado. Recargando página...");
  }

  const tabId = await getActiveTabId();
  if (tabId) {
    chrome.tabs.reload(tabId);
  }
}

// ---- Push dataLayer NOW (immediate, no reload needed) ----
async function labPushDataLayerNow() {
  const code = labDlCode.value.trim();
  if (!code) return;

  let parsed;
  try {
    parsed = JSON.parse(code);
  } catch (e) {
    labShowStatus("Solo JSON válido (comillas dobles), p.ej. {\"event\": \"test\"}");
    return;
  }

  const tabId = await getActiveTabId();
  if (!tabId) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(data);
        console.log("%c[Lab]%c dataLayer.push →", "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold", "color:#a78bfa", data);
      },
      args: [parsed],
      world: "MAIN",
    });
    labShowStatus("Push al dataLayer ejecutado");
  } catch (err) {
    labShowStatus("Error: " + err.message);
  }
}

// ---- Clear all ----
async function labClearAll() {
  labBlocks = [];
  labNextRuleId = 1000;
  labGtmEnabled.checked = false;
  labGtmId.value = "";
  labDlEnabled.checked = false;
  labDlCode.value = "";
  renderLabBlocks();
  updateLabCardStates();
  await labSaveConfig();
  await labApplyBlockRules();
  labShowStatus("Todo limpiado");
}

function labShowStatus(msg) {
  if (!labStatus) return;
  labStatus.textContent = msg;
  labStatus.classList.remove("hidden");
  setTimeout(() => labStatus.classList.add("hidden"), 3000);
}

// ---- Quick block buttons ----
document.querySelectorAll(".lab-quick-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    labAddBlock(btn.dataset.pattern);
  });
});

// ---- Event listeners ----
if (labBlockAddBtn) {
  labBlockAddBtn.addEventListener("click", () => {
    const pattern = labBlockUrl.value.trim();
    if (pattern) {
      labAddBlock(pattern);
      labBlockUrl.value = "";
    }
  });
}
if (labBlockUrl) {
  labBlockUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") labBlockAddBtn.click();
  });
}
if (labDlPushBtn) labDlPushBtn.addEventListener("click", labPushDataLayerNow);
if (labSaveBtn) labSaveBtn.addEventListener("click", labSaveAndReload);
if (labClearBtn) labClearBtn.addEventListener("click", labClearAll);

// Reflect toggle state on cards immediately
if (labGtmEnabled) labGtmEnabled.addEventListener("change", updateLabCardStates);
if (labDlEnabled) labDlEnabled.addEventListener("change", updateLabCardStates);

// Collapsible cards — click or Enter/Space on header toggles body; aria-expanded drives chevron
document.querySelectorAll("#tabLab .lab-card-header").forEach((header) => {
  const toggle = () => {
    const card = header.closest(".lab-card");
    if (!card) return;
    const willExpand = card.classList.contains("is-collapsed");
    card.classList.toggle("is-collapsed", !willExpand);
    header.setAttribute("aria-expanded", String(willExpand));
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
});
