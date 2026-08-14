// Analytics Copilot — Console Capture
// Se inyecta en MAIN world a document_start mientras la captura está activa.
// Envuelve console.* y errores, y guarda las entradas en sessionStorage
// (sobrevive a recargas de la misma pestaña/origen).

(function () {
  if (window.__AC_CONSOLE_HOOKED) return;
  window.__AC_CONSOLE_HOOKED = true;

  var KEY = "__ac_console_logs";
  var MAX = 2000;

  var logs = [];
  try {
    logs = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    if (!Array.isArray(logs)) logs = [];
  } catch (e) { logs = []; }

  var saveScheduled = false;

  function save() {
    saveScheduled = false;
    try {
      if (logs.length > MAX) logs = logs.slice(-MAX);
      sessionStorage.setItem(KEY, JSON.stringify(logs));
    } catch (e) {}
  }

  function scheduleSave() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(save, 300);
  }

  function serializeArg(a) {
    if (a instanceof Error) return a.stack || (a.name + ": " + a.message);
    if (typeof a === "function") return "[function]";
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }

  function record(level, args) {
    try {
      logs.push({
        level: level,
        ts: Date.now(),
        text: Array.prototype.map.call(args, serializeArg).join(" "),
      });
      if (logs.length > MAX) logs = logs.slice(-MAX);
      scheduleSave();
    } catch (e) {}
  }

  ["log", "info", "warn", "error", "debug"].forEach(function (m) {
    var orig = console[m];
    if (typeof orig !== "function") return;
    console[m] = function () {
      try { record(m, arguments); } catch (e) {}
      return orig.apply(console, arguments);
    };
  });

  window.addEventListener("error", function (e) {
    var loc = e.filename ? " @ " + e.filename + ":" + e.lineno + ":" + e.colno : "";
    record("error", [(e.message || "Error") + loc]);
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var reason = e && e.reason;
    var msg = reason && reason.message ? reason.message : String(reason || "");
    record("error", ["Unhandled promise rejection: " + msg]);
  });

  // Flush pendiente antes de que la página se descargue (recarga manual).
  window.addEventListener("pagehide", save, true);
  window.addEventListener("beforeunload", save, true);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") save();
  });
})();
