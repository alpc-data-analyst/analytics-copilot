// Analytics Copilot — Time Travel Content Script
// Runs at document_start on ALL pages.
// Sends message to background to inject Date override via
// chrome.scripting.executeScript (bypasses CSP).

chrome.storage.local.get(["timeTravelEnabled", "timeTravelTarget"]).then(function (data) {
  if (!data.timeTravelEnabled || !data.timeTravelTarget) return;
  chrome.runtime.sendMessage({
    type: "tt-inject",
    target: data.timeTravelTarget,
  }).catch(function () {});
}).catch(function () {});
