/* If the page's scripts never start (blocked, the connection dropped, or the server stopped), buttons, menus and forms
 * that need them do nothing. Instead of a page that silently ignores people, this shows a short, plain message with a
 * Reload button. It never shows file names or technical details; those go to the browser console for developers.
 * It runs before the app's own scripts and checks 12 seconds after the page has loaded. */
(function () {
  var failed = [];
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t.tagName === "SCRIPT" && t.src) failed.push(t.src.replace(location.origin, ""));
  }, true);
  function show(text) {
    if (document.getElementById("js-health")) return;
    var bar = document.createElement("div");
    bar.id = "js-health"; bar.setAttribute("role", "alert");
    bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2000;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#1F2125;color:#fff;padding:14px 16px;border-radius:14px;border-left:5px solid #E3A93F;font:500 15px/1.45 system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.35)";
    var msg = document.createElement("span"); msg.style.cssText = "flex:1 1 240px"; msg.textContent = text;
    var again = document.createElement("button"); again.type = "button"; again.textContent = "Reload";
    again.style.cssText = "min-height:44px;padding:0 18px;border:0;border-radius:999px;background:#E3A93F;color:#17181B;font:700 15px system-ui,sans-serif;cursor:pointer";
    again.onclick = function () { location.reload(); };
    var close = document.createElement("button"); close.type = "button"; close.setAttribute("aria-label", "Close"); close.textContent = "×";
    close.style.cssText = "min-width:44px;min-height:44px;border:0;border-radius:999px;background:transparent;color:#fff;font:400 26px system-ui,sans-serif;cursor:pointer";
    close.onclick = function () { bar.remove(); };
    bar.appendChild(msg); bar.appendChild(again); bar.appendChild(close);
    document.body.appendChild(bar);
  }
  function check() {
    if (document.documentElement.dataset.hydrated === "1") return;
    if (failed.length && window.console) console.warn("Housy: these scripts did not load:", failed);
    if (navigator.onLine === false) { show("You are offline, so parts of this page are not working. Check your connection, then reload."); return; }
    // Can Housy itself be reached? If not, the server is down or the connection dropped; otherwise something blocked the scripts.
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; show("Housy cannot be reached right now, so parts of this page are not working. Check your connection, then reload."); } }, 6000);
    fetch("/api/health", { cache: "no-store" }).then(function (r) {
      if (done) return; done = true; clearTimeout(timer);
      show(r.ok
        ? "Parts of this page did not load, so some buttons and menus may not work. Reload the page. If it keeps happening, try a private window or turn off ad blockers for Housy."
        : "Housy is having trouble right now, so parts of this page are not working. Please reload in a moment.");
    }).catch(function () {
      if (done) return; done = true; clearTimeout(timer);
      show("Housy cannot be reached right now, so parts of this page are not working. Check your connection, then reload.");
    });
  }
  function arm() { setTimeout(check, 12000); }
  if (document.readyState === "complete") arm(); else window.addEventListener("load", arm);
})();
