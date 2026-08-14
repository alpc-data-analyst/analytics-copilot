// =====================================================================
// Analytics Copilot — Background Service Worker (Event Hub)
// =====================================================================

// Red de seguridad: una promesa rechazada sin capturar puede tumbar el service
// worker de MV3 y dejar la extensión en un estado inconsistente. Aquí las
// registramos en vez de dejar que maten al worker.
self.addEventListener("unhandledrejection", (e) => {
  console.warn("[Copilot] Promesa sin capturar:", e.reason);
  e.preventDefault();
});
self.addEventListener("error", (e) => {
  console.warn("[Copilot] Error en el service worker:", e.message);
});

// Helper: request broad host permissions (optional) — returns true if granted
async function ensureHostPermissions() {
  try {
    return await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] });
  } catch (e) {
    // In background SW we can't prompt — the popup must request first
    return false;
  }
}

// Register time-travel content script dynamically (replaces manifest entry)
async function registerTimeTravelCS() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ["time-travel-cs"] });
    if (existing.length > 0) return;
    await chrome.scripting.registerContentScripts([{
      id: "time-travel-cs",
      matches: ["http://*/*", "https://*/*"],
      js: ["content/time-travel-cs.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    }]);
  } catch (e) {}
}

// Register floating widget content script dynamically
async function registerFloatingWidget() {
  try {
    // Unregister first to avoid conflicts with stale registrations
    await chrome.scripting.unregisterContentScripts({ ids: ["floating-widget"] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: "floating-widget",
      matches: ["http://*/*", "https://*/*"],
      js: ["content/floating-widget.js"],
      runAt: "document_end",
      persistAcrossSessions: true,
    }]);
    console.log("[Copilot] Floating widget registered");
  } catch (e) {
    console.warn("[Copilot] Failed to register floating widget:", e.message);
  }
}

// Inject widget into a specific tab right now (for already-loaded pages)
async function injectWidgetIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/floating-widget.js"],
    });
  } catch (e) {
    // Visible en la consola del service worker para poder diagnosticar
    console.warn("[Copilot] No se pudo inyectar el widget en tab", tabId, "→", e.message);
  }
}

// Push widget state update to a specific tab
function pushWidgetUpdate(tabId) {
  (async () => {
    try {
      const data = await chrome.storage.local.get(["timeTravelEnabled", "timeTravelTarget", "labConfig"]);
      const auditTabState = auditState.get(tabId);
      let consoleActive = false;
      try {
        const regs = await chrome.scripting.getRegisteredContentScripts({ ids: ["console-capture-cs"] });
        consoleActive = regs.length > 0;
      } catch (e) {}
      const states = {
        timeTravel: { enabled: !!data.timeTravelEnabled, target: data.timeTravelTarget || null },
        audit: { active: !!(auditTabState && auditTabState.active) },
        consoleCapture: { active: consoleActive },
        lab: data.labConfig || null,
      };
      await injectWidgetIntoTab(tabId);
      chrome.tabs.sendMessage(tabId, { type: "widget-state-update", states }).catch(() => {});
    } catch (e) {}
  })();
}

// On storage change, register/unregister time-travel CS + push widget updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.timeTravelEnabled) {
    if (changes.timeTravelEnabled.newValue) {
      registerTimeTravelCS();
    } else {
      chrome.scripting.unregisterContentScripts({ ids: ["time-travel-cs"] }).catch(() => {});
    }
  }

  // Push widget update to active tab when relevant settings change
  if (changes.timeTravelEnabled || changes.timeTravelTarget || changes.labConfig) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) pushWidgetUpdate(tab.id);
    }).catch(() => {});
  }
});

// On startup, register widget and check time-travel
chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).then(has => {
  if (has) registerFloatingWidget();
}).catch(() => {});
chrome.storage.local.get(["timeTravelEnabled"]).then(data => {
  if (data.timeTravelEnabled) registerTimeTravelCS();
}).catch(() => {});

// When host permissions are granted, register widget
chrome.permissions.onAdded.addListener((perms) => {
  if (perms.origins && perms.origins.length > 0) {
    registerFloatingWidget();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  // Re-register content scripts after update
  chrome.storage.local.get(["timeTravelEnabled"]).then(data => {
    if (data.timeTravelEnabled) registerTimeTravelCS();
  }).catch(() => {});
  chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).then(has => {
    if (has) registerFloatingWidget();
  }).catch(() => {});
});

// =====================================================================
// TIME TRAVEL
// =====================================================================

function timeTravelOverride(targetTimestamp) {
  if (window.__AA_TIME_TRAVEL) return;
  window.__AA_TIME_TRAVEL = true;

  var RealDate = window.Date;
  var offset = targetTimestamp - RealDate.now();

  function FakeDate() {
    var a = [].slice.call(arguments);
    if (a.length === 0) {
      var fn = new RealDate(RealDate.now() + offset);
      if (this instanceof FakeDate) return fn;
      return fn.toString();
    }
    if (this instanceof FakeDate) {
      switch (a.length) {
        case 1: return new RealDate(a[0]);
        case 2: return new RealDate(a[0], a[1]);
        case 3: return new RealDate(a[0], a[1], a[2]);
        case 4: return new RealDate(a[0], a[1], a[2], a[3]);
        case 5: return new RealDate(a[0], a[1], a[2], a[3], a[4]);
        case 6: return new RealDate(a[0], a[1], a[2], a[3], a[4], a[5]);
        default: return new RealDate(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
      }
    }
    return new RealDate(a[0]).toString();
  }

  FakeDate.prototype = Object.create(RealDate.prototype);
  FakeDate.prototype.constructor = FakeDate;
  FakeDate.now = function () { return RealDate.now() + offset; };
  FakeDate.parse = function () { return RealDate.parse.apply(RealDate, arguments); };
  FakeDate.UTC = function () { return RealDate.UTC.apply(RealDate, arguments); };
  try { Object.defineProperty(FakeDate, "name", { value: "Date", configurable: true }); } catch (e) {}
  try { Object.defineProperty(FakeDate, "length", { value: 7, configurable: true }); } catch (e) {}

  window.Date = FakeDate;

  console.log(
    "%c[Time Travel]%c Active \u2192 " + new FakeDate().toLocaleString(),
    "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
    "color:#a78bfa"
  );
}


// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Widget: return current extension state
  if (message.type === "widget-get-status") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["timeTravelEnabled", "timeTravelTarget", "labConfig"]);
        const tabId = sender.tab?.id;
        const auditTabState = tabId ? auditState.get(tabId) : null;
        let consoleActive = false;
        try {
          const regs = await chrome.scripting.getRegisteredContentScripts({ ids: ["console-capture-cs"] });
          consoleActive = regs.length > 0;
        } catch (e) {}
        sendResponse({
          timeTravel: { enabled: !!data.timeTravelEnabled, target: data.timeTravelTarget || null },
          audit: { active: !!(auditTabState && auditTabState.active) },
          consoleCapture: { active: consoleActive },
          lab: data.labConfig || null,
        });
      } catch (e) {
        sendResponse(null);
      }
    })();
    return true;
  }

  // Popup pide refrescar el widget de una pestaña (p.ej. tras toggle de consola)
  if (message.type === "widget-refresh" && message.tabId) {
    pushWidgetUpdate(message.tabId);
    return;
  }

  // Time Travel: content script asks us to inject (bypasses CSP)
  if (message.type === "tt-inject" && sender.tab?.id) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: timeTravelOverride,
      args: [message.target],
      world: "MAIN",
    }).catch(() => {});
    return;
  }

});

// =====================================================================
// LAB — Inject GTM / dataLayer / Scripts on page load
// =====================================================================

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  // Skip chrome:// and extension pages
  if (!details.url.startsWith("http")) return;

  // Check host permissions before injecting (optional_host_permissions)
  if (!await ensureHostPermissions()) return;

  try {
    const { labConfig } = await chrome.storage.local.get("labConfig");
    if (!labConfig) return;

    // 1. Inject GTM container
    if (labConfig.gtm?.enabled) {
      const gtmId = labConfig.gtm.containerId?.trim();

      if (gtmId && /^GTM-[A-Z0-9]+$/i.test(gtmId)) {
        await chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          func: (containerId) => {
            // Robust GTM snippet — handles early injection when DOM isn't ready
            function loadGTM() {
              window.dataLayer = window.dataLayer || [];
              window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
              var j = document.createElement("script");
              j.async = true;
              j.src = "https://www.googletagmanager.com/gtm.js?id=" + containerId;
              // Find a place to insert — head, first script, or documentElement
              var target = document.head || document.getElementsByTagName("script")[0]?.parentNode || document.documentElement;
              target.appendChild(j);
              console.log(
                "%c[Lab]%c GTM inyectado → " + containerId,
                "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
                "color:#a78bfa"
              );
            }
            // If DOM isn't ready yet, wait for it; otherwise inject now
            if (document.head || document.documentElement) {
              loadGTM();
            } else {
              document.addEventListener("DOMContentLoaded", loadGTM, { once: true });
            }
          },
          args: [gtmId],
          world: "MAIN",
          injectImmediately: true,
        }).catch((e) => console.error("[Lab] GTM inject error:", e));
      }
    }

    // 2. Push to dataLayer
    if (labConfig.dataLayer?.enabled && labConfig.dataLayer?.code) {
      let dlParsed = null;
      try { dlParsed = JSON.parse(labConfig.dataLayer.code); } catch (e) {}
      if (dlParsed !== null) {
        await chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          func: (data) => {
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push(data);
            console.log("%c[Lab]%c dataLayer.push (auto) →",
              "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold", "color:#a78bfa", data);
          },
          args: [dlParsed],
          world: "MAIN",
          injectImmediately: true,
        }).catch(() => {});
      }
    }

  } catch (e) {
    // Extension context may be invalidated during navigation
  }
});

// =====================================================================
// COOKIE AUDIT — Cross-domain session & cookie monitoring
// =====================================================================

const auditState = new Map(); // tabId -> { active, startTime, startUrl, snapshot, history, alerts, timeline, eTLDplus1 }

// Cache of last-known cookie values, keyed by `${domain}|${name}`.
// Used to diff oldValue→newValue on chrome.cookies.onChanged events.
const cookieValueCache = new Map();

// Coarse eTLD+1 computation — sufficient for detecting cross-domain navigation.
// Covers common 2-part TLDs; anything else falls back to last 2 parts.
const TWO_PART_TLDS = new Set([
  "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "co.in", "co.il", "co.id",
  "com.au", "com.br", "com.mx", "com.ar", "com.cn", "com.tr", "com.co", "com.pe", "com.ve",
  "com.sg", "com.hk", "com.tw", "com.my", "com.ph", "com.pk", "com.sa", "com.eg",
  "org.uk", "net.au", "ac.uk", "gov.uk", "ne.jp", "or.jp",
]);

function getETLDplus1(hostname) {
  if (!hostname) return "";
  const h = hostname.replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return last2;
}

// Returns true if `cookieDomain` (e.g. `.example.com`) covers `auditHost`.
function cookieDomainCoversHost(cookieDomain, auditHost) {
  if (!cookieDomain || !auditHost) return false;
  const cd = cookieDomain.replace(/^\./, "").toLowerCase();
  const ah = auditHost.replace(/^www\./, "").toLowerCase();
  return cd === ah || ah.endsWith("." + cd) || cd.endsWith("." + ah);
}

function getAuditState(tabId) {
  return auditState.get(tabId) || null;
}

// Append a timeline event to an audit; caps the timeline at 500 entries
// and notifies the popup so it can re-render in real time.
// Añade una alerta evitando duplicados por título y con tope (30) para que
// una sesión larga de navegación no acumule alertas sin fin.
function pushAuditAlert(state, alert) {
  if (!state.alerts) state.alerts = [];
  if (state.alerts.some(a => a.title === alert.title)) return;
  state.alerts.push(alert);
  if (state.alerts.length > 30) state.alerts = state.alerts.slice(-30);
}

function addTimelineEvent(state, event) {
  if (!state.timeline) state.timeline = [];
  const entry = Object.assign({ ts: Date.now() }, event);
  state.timeline.push(entry);
  if (state.timeline.length > 500) state.timeline = state.timeline.slice(-500);
  // Fire-and-forget push to popup. If the popup isn't open this rejects silently.
  try {
    chrome.runtime.sendMessage({
      type: "audit-timeline-event",
      tabId: state.tabId,
      event: entry,
    }).catch(() => {});
  } catch (e) {}
  return entry;
}

// Parse _ga cookie → client ID
function parseCookieClientId(cookies) {
  const ga = cookies.find(c => c.name === "_ga");
  if (!ga) return null;
  const parts = ga.value.split(".");
  return parts.length >= 4 ? parts[2] + "." + parts[3] : ga.value;
}

// Parse _ga_* cookies → session data
function parseCookieSessions(cookies) {
  const sessions = [];
  for (const c of cookies) {
    if (/^_ga_[A-Z0-9]+$/.test(c.name)) {
      const mid = "G-" + c.name.replace("_ga_", "");
      const parts = c.value.split(".");
      const sess = { cookieName: c.name, measurementId: mid, raw: c.value, sessionId: null, sessionCount: null };
      // Try to extract session ID and count from GS format
      if (parts.length >= 4) {
        const tsVal = parseInt(parts[2], 10);
        if (tsVal > 1000000000) sess.sessionStart = tsVal;
        if (parts.length >= 5) {
          const sct = parseInt(parts[3], 10);
          if (!isNaN(sct) && sct > 0 && sct < 100000) sess.sessionCount = sct;
        }
      }
      sessions.push(sess);
    }
  }
  return sessions;
}

// Capture cookie snapshot for a tab.
// Reads through BOTH paths (chrome.cookies API when permitted, plus
// document.cookie from the page) and merges them. This guards against:
//  - chrome.cookies returning stale results right after a permission grant
//  - document.cookie missing httpOnly cookies
//  - pages where one path is blocked/slow
async function captureAuditSnapshot(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url;
  if (!url || !url.startsWith("http")) return null;
  const hostname = new URL(url).hostname;

  const cookieMap = new Map(); // key: `${domain}|${name}` → cookie object

  // Path 1 — chrome.cookies.getAll (rich metadata, needs "cookies" permission).
  // Query by eTLD+1 domain to catch cookies set on any subdomain (more permissive
  // than { url } which only returns cookies that match the URL's path/scheme).
  try {
    const hasPerm = await chrome.permissions.contains({ permissions: ["cookies"] });
    if (hasPerm) {
      const eTLDplus1 = getETLDplus1(hostname);
      const queries = [
        chrome.cookies.getAll({ url }),
        chrome.cookies.getAll({ domain: eTLDplus1 || hostname }),
      ];
      const results = await Promise.all(queries.map(p => p.catch(() => [])));
      for (const list of results) {
        for (const c of list || []) {
          cookieMap.set((c.domain || hostname) + "|" + c.name, c);
        }
      }
    }
  } catch (e) {}

  // Path 2 — document.cookie (name/value only, but works without permission)
  try {
    const [cookieResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const parsed = [];
        if (!document.cookie) return parsed;
        for (const pair of document.cookie.split(";")) {
          const eq = pair.indexOf("=");
          if (eq < 0) continue;
          parsed.push({ name: pair.substring(0, eq).trim(), value: pair.substring(eq + 1).trim() });
        }
        return parsed;
      },
      world: "MAIN",
    });
    const docCookies = cookieResult?.result || [];
    for (const dc of docCookies) {
      // Skip if chrome.cookies already supplied this one for any domain scope
      let seen = false;
      for (const key of cookieMap.keys()) {
        if (key.endsWith("|" + dc.name)) { seen = true; break; }
      }
      if (seen) continue;
      cookieMap.set(hostname + "|" + dc.name, {
        name: dc.name,
        value: dc.value,
        domain: hostname,
      });
    }
  } catch (e) {}

  const cookies = Array.from(cookieMap.values());
  const clientId = parseCookieClientId(cookies);
  const sessions = parseCookieSessions(cookies);

  // Filter to the cookies that matter for session diagnosis.
  const trackingCookies = cookies.filter(c => isTrackingCookie(c.name));

  // Try to get GA4 session info from page
  let ga4SessionData = null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hits = [];
        try {
          const entries = performance.getEntriesByType("resource");
          for (const e of entries) {
            if (e.name.indexOf("/g/collect") === -1) continue;
            if (e.name.indexOf("google-analytics.com") === -1 && e.name.indexOf("analytics.google.com") === -1) continue;
            try {
              const u = new URL(e.name);
              const p = u.searchParams;
              hits.push({
                tid: p.get("tid"), cid: p.get("cid"), sid: p.get("sid"),
                sct: p.get("sct"), _ss: p.get("_ss"), _fv: p.get("_fv"),
                en: p.get("en"),
              });
            } catch (e2) {}
          }
        } catch (e) {}
        return hits;
      },
      world: "MAIN",
    });
    ga4SessionData = result?.result || [];
  } catch (e) {}

  const mappedCookies = trackingCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || hostname,
    path: c.path || "/",
    httpOnly: c.httpOnly || false,
    secure: c.secure || false,
    sameSite: c.sameSite || null,
    session: c.session === true || c.expirationDate == null,
    expirationDate: c.expirationDate || null,
  }));
  // Prime the value cache so subsequent onChanged events can diff correctly.
  for (const c of mappedCookies) {
    cookieValueCache.set(c.domain + "|" + c.name, c.value);
  }
  // Lista completa (no solo tracking) para la vista "ver todas" del popup
  const allMapped = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || hostname,
    httpOnly: c.httpOnly || false,
    secure: c.secure || false,
    sameSite: c.sameSite || null,
    session: c.session === true || c.expirationDate == null,
    expirationDate: c.expirationDate || null,
  }));

  return {
    url,
    hostname,
    eTLDplus1: getETLDplus1(hostname),
    timestamp: Date.now(),
    cookies: mappedCookies,
    allCookies: allMapped,
    clientId,
    sessions,
    ga4Hits: ga4SessionData || [],
  };
}

// ---- Real-time cookie change listener ----
// Chrome fires TWO events for an overwrite (one remove + one create). We
// coalesce those pairs within 400ms so the UI shows a single "updated" event
// instead of a misleading "deleted + re-created" pair.
const pendingCookieRemovals = new Map(); // `${tabId}|${domain}|${name}` -> { timer, oldValue, cause }
const COOKIE_COALESCE_MS = 400;

// Cookies that matter for "session loss" diagnosis. Deliberately narrow:
// TikTok's ttcsid and Microsoft's _uet* session IDs update every few seconds
// and would flood the timeline without helping the user.
function isTrackingCookie(name) {
  if (name === "_ga" || name === "_gid" ||
      name === "_fbp" || name === "_fbc" || name === "_ttp" ||
      name === "FPID" || name === "ttclid") return true;
  if (/^_ga_[A-Z0-9]+$/.test(name)) return true;
  // Toda la familia de atribución de Google Ads: _gcl_au (linker), _gcl_aw
  // (gclid), _gcl_gb (wbraid), _gcl_gs, _gcl_dc — y sus equivalentes sGTM (FPGCL*)
  if (/^_gcl_/.test(name)) return true;
  if (/^FPGCL/.test(name)) return true;
  return false;
}

function cookieAttrs(cookie) {
  return {
    path: cookie.path || "/",
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite || null,
    session: cookie.session === true,
    expirationDate: cookie.expirationDate || null,
  };
}

// For `_ga_*` cookies, only the session_start (`.sNNN`) and session_count
// (`$oNNN`) carry real diagnostic signal. Everything else (`$t/$j/$s/$e/$g`)
// is counter churn that GA4 rewrites on every hit — surfacing it floods the
// timeline with noise and makes the real events impossible to spot.
function gaSessionFingerprint(v) {
  const s = (v || "").match(/\.s(\d+)/);
  const o = (v || "").match(/\$o(\d+)/);
  return (s ? s[1] : "") + "|" + (o ? o[1] : "");
}

function isMeaningfulCookieChange(name, oldValue, newValue) {
  if (oldValue === newValue) return false;
  // _ga_*: only surface when session_start or session_count changes.
  if (/^_ga_/i.test(name) && oldValue) {
    return gaSessionFingerprint(oldValue) !== gaSessionFingerprint(newValue);
  }
  // _ga: only surface when client_id (parts 2-3) changes. The trailing
  // timestamp refreshes on every hit.
  if (name === "_ga" && oldValue) {
    const fp = v => {
      const parts = (v || "").split(".");
      return parts.length >= 4 ? parts[2] + "." + parts[3] : v;
    };
    return fp(oldValue) !== fp(newValue);
  }
  return true;
}

function onCookieChanged(changeInfo) {
  const cookie = changeInfo.cookie;
  if (!cookie) return;

  for (const [tabId, state] of auditState) {
    if (!state.active || !state.startHostname) continue;
    if (!cookieDomainCoversHost(cookie.domain, state.startHostname)) continue;

    const key = tabId + "|" + cookie.domain + "|" + cookie.name;
    const cacheKey = cookie.domain + "|" + cookie.name;

    if (changeInfo.removed) {
      // Hold the removal briefly: if a matching create follows, it was just an
      // overwrite; if not, it's a genuine deletion and we emit then.
      const oldValue = cookieValueCache.get(cacheKey) || null;
      // Cancel any previous pending for the same key
      const prev = pendingCookieRemovals.get(key);
      if (prev) clearTimeout(prev.timer);
      const pending = {
        oldValue,
        cause: changeInfo.cause || "unknown",
        cookie,
      };
      pending.timer = setTimeout(() => {
        pendingCookieRemovals.delete(key);
        cookieValueCache.delete(cacheKey);
        const name = cookie.name;
        const tracking = isTrackingCookie(name);
        // Only surface removals for tracking cookies; non-tracking removals are noise.
        if (!tracking) return;
        addTimelineEvent(state, {
          type: "cookie",
          name,
          domain: cookie.domain,
          cause: pending.cause,
          removed: true,
          oldValue: pending.oldValue,
          newValue: null,
          attrs: cookieAttrs(cookie),
          isTracking: true,
        });
        persistAuditState();
      }, COOKIE_COALESCE_MS);
      pendingCookieRemovals.set(key, pending);
      continue;
    }

    // Non-remove event: either a new cookie, or the second half of an overwrite.
    const pending = pendingCookieRemovals.get(key);
    const previousValue = cookieValueCache.get(cacheKey) || (pending ? pending.oldValue : null);

    if (pending) {
      clearTimeout(pending.timer);
      pendingCookieRemovals.delete(key);
    }

    cookieValueCache.set(cacheKey, cookie.value);

    const tracking = isTrackingCookie(cookie.name);
    // Only emit cookie events for tracking cookies to keep the timeline focused.
    if (!tracking) continue;

    // If this is an overwrite that didn't actually change the value, skip silently.
    if (previousValue !== null && !isMeaningfulCookieChange(cookie.name, previousValue, cookie.value)) {
      continue;
    }

    addTimelineEvent(state, {
      type: "cookie",
      name: cookie.name,
      domain: cookie.domain,
      cause: pending ? "overwrite" : (changeInfo.cause || "explicit"),
      removed: false,
      oldValue: previousValue,
      newValue: cookie.value,
      attrs: cookieAttrs(cookie),
      isTracking: true,
    });
  }
  persistAuditState();
}

// Register the cookie listener only when the optional `cookies` permission is granted.
// Otherwise `chrome.cookies` is undefined and accessing `.onChanged` would crash the SW.
function registerCookieListener() {
  if (!chrome.cookies?.onChanged) return;
  if (chrome.cookies.onChanged.hasListener?.(onCookieChanged)) return;
  chrome.cookies.onChanged.addListener(onCookieChanged);
}

chrome.permissions.contains({ permissions: ["cookies"] })
  .then((has) => { if (has) registerCookieListener(); })
  .catch(() => {});

chrome.permissions.onAdded.addListener((perms) => {
  if (perms.permissions?.includes("cookies")) registerCookieListener();
});

// Compare current cookies against snapshot
function compareAuditCookies(snapshot, current) {
  const alerts = [];
  const cookieDiff = [];

  // Index current cookies by name
  const currentMap = new Map();
  for (const c of current.cookies) currentMap.set(c.name, c);

  // Check each snapshot cookie
  for (const sc of snapshot.cookies) {
    const cc = currentMap.get(sc.name);
    if (!cc) {
      // LOST
      cookieDiff.push({ name: sc.name, status: "lost", oldValue: sc.value, domain: sc.domain, expirationDate: sc.expirationDate });
      if (sc.name === "_ga") {
        alerts.push({ type: "error", title: "Client ID perdido", detail: `Cookie _ga eliminada — GA4 asignará un nuevo usuario`, timestamp: Date.now() });
      } else if (/^_ga_/.test(sc.name)) {
        alerts.push({ type: "error", title: "Sesión GA4 perdida", detail: `Cookie ${sc.name} eliminada — se creará una sesión nueva`, timestamp: Date.now() });
      } else {
        alerts.push({ type: "warn", title: `Cookie perdida: ${sc.name}`, detail: `Domain: ${sc.domain}`, timestamp: Date.now() });
      }
    } else if (cc.value !== sc.value) {
      // CHANGED
      cookieDiff.push({ name: sc.name, status: "changed", oldValue: sc.value, newValue: cc.value, domain: cc.domain, expirationDate: cc.expirationDate });
    } else {
      // OK
      cookieDiff.push({ name: sc.name, status: "ok", value: sc.value, domain: sc.domain, expirationDate: sc.expirationDate });
    }
    currentMap.delete(sc.name);
  }

  // New cookies not in snapshot
  for (const [name, cc] of currentMap) {
    cookieDiff.push({ name, status: "new", value: cc.value, domain: cc.domain, expirationDate: cc.expirationDate });
  }

  // Check client ID change — a true anomaly (client_id should be stable for 2 years)
  if (snapshot.clientId && current.clientId && snapshot.clientId !== current.clientId) {
    alerts.push({ type: "error", title: "Client ID cambiado", detail: `Antes: ${snapshot.clientId} → Ahora: ${current.clientId}. El usuario será contado como uno nuevo.`, timestamp: Date.now() });
  }

  // Check session count / session start change. _ss=1 alone is NOT an alert —
  // it's expected on a user's first hit. We only flag it when a prior session
  // existed in the snapshot and has now been replaced.
  if (snapshot.sessions.length > 0 && current.sessions.length > 0) {
    const oldSess = snapshot.sessions[0];
    const newSess = current.sessions.find(s => s.measurementId === oldSess.measurementId) || current.sessions[0];
    if (oldSess.sessionCount && newSess.sessionCount && newSess.sessionCount > oldSess.sessionCount) {
      alerts.push({ type: "warn", title: "Session count incrementado", detail: `Sesión #${oldSess.sessionCount} → #${newSess.sessionCount}. GA4 considera que empezó una nueva sesión.`, timestamp: Date.now() });
    } else if (oldSess.sessionStart && newSess.sessionStart && newSess.sessionStart > oldSess.sessionStart + 60) {
      // New sessionStart timestamp ⇒ the session cookie was replaced entirely (session reset).
      alerts.push({ type: "error", title: "Sesión GA4 reiniciada", detail: `Se detectó un sessionStart nuevo. La sesión anterior se perdió y GA4 ha abierto una nueva.`, timestamp: Date.now() });
    }
  }

  return { cookieDiff, alerts };
}

// Persist audit state to session storage. Throttled to 1s because cookie events
// can fire many times per second on tracking-heavy pages.
let _persistAuditTimer = null;
async function _doPersistAuditState() {
  const data = {};
  for (const [tabId, state] of auditState) {
    if (state.active) {
      data[tabId] = state;
    }
  }
  try {
    await chrome.storage.session.set({ auditTabs: data });
  } catch (e) {}
}
function persistAuditState() {
  if (_persistAuditTimer) return;
  _persistAuditTimer = setTimeout(() => {
    _persistAuditTimer = null;
    _doPersistAuditState();
  }, 1000);
}

async function restoreAuditState() {
  try {
    const { auditTabs } = await chrome.storage.session.get(["auditTabs"]);
    if (auditTabs) {
      for (const [tabId, state] of Object.entries(auditTabs)) {
        const tid = parseInt(tabId, 10);
        try {
          await chrome.tabs.get(tid); // verify tab exists
          auditState.set(tid, state);
        } catch (e) {} // tab gone
      }
    }
  } catch (e) {}
}
restoreAuditState();

// Message handlers for audit
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.type?.startsWith("audit-")) return;

  switch (message.type) {
    case "audit-start": {
      const tabId = message.tabId;
      captureAuditSnapshot(tabId).then(snapshot => {
        if (!snapshot) {
          sendResponse({ ok: false, error: "No se pudo capturar snapshot" });
          return;
        }
        const state = {
          tabId,
          active: true,
          startTime: Date.now(),
          startUrl: snapshot.url,
          startHostname: snapshot.hostname,
          eTLDplus1: snapshot.eTLDplus1 || getETLDplus1(snapshot.hostname),
          lastHostname: snapshot.hostname,
          snapshot,
          history: [{ url: snapshot.url, hostname: snapshot.hostname, timestamp: Date.now(), cookieCount: snapshot.cookies.length }],
          alerts: [],
          timeline: [],
        };
        addTimelineEvent(state, {
          type: "nav",
          url: snapshot.url,
          hostname: snapshot.hostname,
          initial: true,
        });
        auditState.set(tabId, state);
        persistAuditState();
        pushWidgetUpdate(tabId);
        sendResponse({ ok: true, snapshot });
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }

    case "audit-get-timeline": {
      const state = auditState.get(message.tabId);
      if (!state) { sendResponse({ ok: false, error: "No hay audit" }); break; }
      const since = message.since || 0;
      const items = (state.timeline || []).filter(e => e.ts > since);
      sendResponse({ ok: true, items, eTLDplus1: state.eTLDplus1 || null });
      break;
    }

    case "audit-clear-timeline": {
      const state = auditState.get(message.tabId);
      if (state) state.timeline = [];
      sendResponse({ ok: true });
      break;
    }

    case "audit-stop": {
      const state = auditState.get(message.tabId);
      if (state) state.active = false;
      persistAuditState();
      pushWidgetUpdate(message.tabId);
      sendResponse({ ok: true });
      break;
    }

    case "audit-get-state": {
      const state = getAuditState(message.tabId);
      sendResponse({ state });
      break;
    }

    case "audit-check": {
      const tabId = message.tabId;
      const state = auditState.get(tabId);
      if (!state || !state.active) {
        sendResponse({ ok: false, error: "No hay audit activo" });
        break;
      }
      captureAuditSnapshot(tabId).then(current => {
        if (!current) {
          sendResponse({ ok: false, error: "No se pudo leer cookies" });
          return;
        }
        const { cookieDiff, alerts } = compareAuditCookies(state.snapshot, current);
        // Accumulate alerts (deduplicate by title)
        if (state.alerts.length > 30) state.alerts = state.alerts.slice(-30);
        const existingTitles = new Set(state.alerts.map(a => a.title));
        for (const a of alerts) {
          if (!existingTitles.has(a.title)) {
            state.alerts.push(a);
            existingTitles.add(a.title);
          }
        }
        sendResponse({ ok: true, current, cookieDiff, alerts: state.alerts, history: state.history });
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }
  }
});

// Monitor navigation on audited tabs.
// Every navigation emits a `nav` timeline event; cross-eTLD+1 hops also emit
// a `xdomain` event that checks for the `_gl=` Google Linker parameter.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const state = auditState.get(tabId);
  if (!state || !state.active) return;

  try {
    const u = new URL(changeInfo.url);
    const hostname = u.hostname;
    const prevHostname = state.lastHostname || state.startHostname;
    state.history.push({ url: changeInfo.url, hostname, timestamp: Date.now() });
    if (state.history.length > 50) state.history = state.history.slice(-50);

    // Timeline: navigation
    addTimelineEvent(state, {
      type: "nav",
      url: changeInfo.url,
      hostname,
      prevHostname,
    });

    // Cross-domain detection
    const prevETLD = getETLDplus1(prevHostname);
    const newETLD = getETLDplus1(hostname);
    if (prevETLD && newETLD && prevETLD !== newETLD) {
      const hasLinker = u.searchParams.has("_gl");
      const clickParam = ["gclid", "gbraid", "wbraid", "dclid"].find((k) => u.searchParams.has(k));

      if (clickParam) {
        // Aterrizaje de anuncio: NO es una rotura de sesión (GA4 abre sesión nueva
        // con atribución de campaña). Re-anclamos el audit al dominio de destino
        // para que las cookies monitorizadas y el snapshot sean los del anunciante.
        addTimelineEvent(state, {
          type: "xdomain",
          from: prevHostname,
          to: hostname,
          fromETLD: prevETLD,
          toETLD: newETLD,
          hasLinker,
          adClick: true,
          clickParam,
          url: changeInfo.url,
        });
        state.startHostname = hostname;
        state.eTLDplus1 = newETLD;
        // Snapshot fresco del dominio destino (con margen para que gtag setee _gcl_aw)
        setTimeout(() => {
          if (!state.active) return;
          captureAuditSnapshot(tabId).then((snap) => {
            if (snap && state.active) {
              state.snapshot = snap;
              persistAuditState();
            }
          }).catch(() => {});
        }, 2500);
      } else {
        addTimelineEvent(state, {
          type: "xdomain",
          from: prevHostname,
          to: hostname,
          fromETLD: prevETLD,
          toETLD: newETLD,
          hasLinker,
          url: changeInfo.url,
        });
        // Surface as a persistent alert too so it doesn't get lost in the timeline
        const title = hasLinker
          ? "Salto cross-domain con linker"
          : "Salto cross-domain sin linker";
        const detail = hasLinker
          ? `${prevETLD} → ${newETLD} · _gl presente, GA4 puede pasar el client_id.`
          : `${prevETLD} → ${newETLD} · falta el parámetro _gl — el client_id de GA4 se pierde y la sesión se rompe.`;
        pushAuditAlert(state, {
          type: hasLinker ? "info" : "error",
          title,
          detail,
          timestamp: Date.now(),
        });
      }
    }

    state.lastHostname = hostname;
    persistAuditState();

    // Notify popup for re-render
    chrome.runtime.sendMessage({ type: "audit-navigation", tabId, url: changeInfo.url }).catch(() => {});
  } catch (e) {}
});

// Clean up audit on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (auditState.has(tabId)) {
    auditState.delete(tabId);
    persistAuditState();
  }
});

