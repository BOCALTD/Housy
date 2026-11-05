/* If the page's scripts never start (blocked, or failed to download), buttons, menus and forms that need them do nothing.
 * Instead of leaving people with a page that silently ignores them, this says so and says why. It runs before the app's
 * own scripts, notes any script that fails to load, and checks 12 seconds after the page has loaded. */
(function () {
  var failed = [];
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t.tagName === "SCRIPT" && t.src) failed.push(t.src.replace(location.origin, ""));
  }, true);
  function check() {
    var H = document.documentElement;
    if (H.dataset.hydrated === "1" || document.getElementById("js-health")) return;
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var why = failed.length
      ? "These files did not load: " + failed.slice(0, 3).join(", ") + (failed.length > 3 ? " and " + (failed.length - 3) + " more" : "") + "."
      : "The page's scripts were blocked or did not start.";
    var hint = !local && location.port === "3000"
      ? " If this is the development server (npm run dev) opened from another address, add that address to DEV_ORIGINS in .env and restart it, or use the production server (npm run build, then npm start)."
      : " Reload the page. If it keeps happening, an extension or a network filter may be blocking scripts; try a private window.";
    var bar = document.createElement("div");
    bar.id = "js-health"; bar.setAttribute("role", "alert");
    bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2000;background:#7F1D1D;color:#fff;padding:14px 16px;border-radius:12px;font:500 14px/1.45 system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.35)";
    bar.textContent = "Parts of this page are not working: buttons, menus and typing need the page's scripts, which have not started. " + why + hint;
    document.body.appendChild(bar);
  }
  function arm() { setTimeout(check, 12000); }
  if (document.readyState === "complete") arm(); else window.addEventListener("load", arm);
})();
