/**
 * Every message and window, on every screen size. Opens /qa/states (only present when QA_STATES=1) on phones in both
 * orientations, a very narrow phone, large iPhones, tablets both ways and computers, signed in (so the bottom menu, side
 * menu, bell and assistant are there too), and for each message and window checks that it:
 *  - is fully on the screen (or scrolls inside itself when taller than the screen), with nothing running off the side;
 *  - has text of at least 12px and buttons of at least 44px that a tap actually reaches (nothing lies on top of them);
 *  - does not sit on top of the bottom menu (except windows that cover the whole page on purpose);
 *  - closes again (Escape, or its close button).
 * Writes device-report/states/report.md with pictures; fails CI on any problem unless STATES_STRICT=false.
 */
import { chromium, webkit, devices, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "device-report/states";
mkdirSync(OUT, { recursive: true });

const narrow: BrowserContextOptions = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent };
const PROFILES: { name: string; engine: "chromium" | "webkit"; opts: BrowserContextOptions; shots?: boolean }[] = [
  { name: "Narrow phone 320", engine: "chromium", opts: narrow, shots: true },
  { name: "iPhone SE", engine: "webkit", opts: devices["iPhone SE"], shots: true },
  { name: "iPhone SE landscape", engine: "webkit", opts: devices["iPhone SE landscape"], shots: true },
  { name: "iPhone 15 Pro Max", engine: "webkit", opts: devices["iPhone 15 Pro Max"] },
  { name: "Pixel 7", engine: "chromium", opts: devices["Pixel 7"] },
  { name: "Pixel 7 landscape", engine: "chromium", opts: devices["Pixel 7 landscape"] },
  { name: "iPad Mini", engine: "webkit", opts: devices["iPad Mini"], shots: true },
  { name: "iPad Pro 11 landscape", engine: "webkit", opts: devices["iPad Pro 11 landscape"] },
  { name: "Laptop 1366", engine: "chromium", opts: { viewport: { width: 1366, height: 768 } }, shots: true },
  { name: "Wide 1920", engine: "chromium", opts: { viewport: { width: 1920, height: 1080 } } },
];

type Finding = { profile: string; item: string; problem: string };
const findings: Finding[] = [];
const passed: string[] = [];
const shots: string[] = [];

/** Measures one element on the page: on screen, overflow, text size, buttons, and what covers what. */
const MEASURE = `(function (sel, opts) {
  var el = document.querySelector(sel);
  if (!el) return { missing: true };
  var vw = document.documentElement.clientWidth, vh = window.innerHeight, r = el.getBoundingClientRect(), out = [];
  var st = getComputedStyle(el);
  var scrolls = /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1;
  if (r.left < -0.5 || r.right > vw + 0.5) out.push("runs off the side of the screen (" + Math.round(r.left) + " to " + Math.round(r.right) + " of " + vw + ")");
  if (opts.fixed && (r.top < -0.5 || (r.bottom > vh + 0.5 && !scrolls))) out.push("does not fit the screen's height and does not scroll (" + Math.round(r.top) + " to " + Math.round(r.bottom) + " of " + vh + ")");
  if (el.scrollWidth > el.clientWidth + 1 && !/(auto|scroll)/.test(st.overflowX)) out.push("its content is wider than it (" + el.scrollWidth + " > " + el.clientWidth + ")");
  // Inside a box that clips its content (overflow hidden), what runs past the box is not seen, so it does not count.
  function clipped(n) { for (var a = n.parentElement; a && a !== document.body; a = a.parentElement) { var s2 = getComputedStyle(a); if (/(hidden|clip)/.test(s2.overflowX)) { var ar = a.getBoundingClientRect(); if (ar.right <= vw + 0.5) return true; } } return false; }
  // A button scrolled partly out of its scrolling box is under the box's edges on purpose; the person scrolls to it.
  function scrolledAway(n, nr) { for (var a = n.parentElement; a && a !== el.parentElement; a = a.parentElement) { var s3 = getComputedStyle(a); if (/(auto|scroll)/.test(s3.overflowY) && a.scrollHeight > a.clientHeight + 1) { var ar2 = a.getBoundingClientRect(); return nr.top < ar2.top - 0.5 || nr.bottom > ar2.bottom + 0.5; } } return false; }
  var all = el.querySelectorAll("*"), small = 0, smallWhat = "";
  for (var i = 0; i < all.length; i++) {
    var e = all[i], cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var direct = false;
    for (var k = 0; k < e.childNodes.length; k++) if (e.childNodes[k].nodeType === 3 && e.childNodes[k].textContent.trim()) direct = true;
    if (direct && parseFloat(cs.fontSize) < 12) { small++; smallWhat = (e.textContent || "").trim().slice(0, 30); }
    var er = e.getBoundingClientRect();
    if (er.right > vw + 0.5 && er.width > 0 && cs.position !== "fixed" && !e.closest("svg") && !clipped(e)) out.push("something inside runs off the side: \\"" + (e.textContent || e.tagName).trim().slice(0, 30) + "\\"");
  }
  if (small) out.push(small + " piece(s) of text smaller than 12px, e.g. \\"" + smallWhat + "\\"");
  var targets = el.querySelectorAll("button, a.btn, [role=button], input[type=submit]");
  for (var j = 0; j < targets.length; j++) {
    var t = targets[j], tr = t.getBoundingClientRect(), ts = getComputedStyle(t);
    if (ts.display === "none" || ts.visibility === "hidden" || tr.width === 0) continue;
    var name = (t.getAttribute("aria-label") || t.textContent || "").trim().slice(0, 30);
    if (Math.min(tr.width, tr.height) < 43.5) out.push("button \\"" + name + "\\" is " + Math.round(tr.width) + "x" + Math.round(tr.height) + "px (needs 44)");
    var cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2;
    if (cx >= 0 && cx <= vw && cy >= 0 && cy <= vh && !scrolledAway(t, tr)) { var top = document.elementFromPoint(cx, cy); if (top && top !== t && !t.contains(top)) out.push("button \\"" + name + "\\" is covered by " + (top.className && top.className.baseVal === undefined ? "." + String(top.className).split(" ")[0] : top.tagName)); }
  }
  if (opts.notOverMenu) {
    var tab = document.querySelector(".tabbar");
    if (tab) { var tb = tab.getBoundingClientRect(); var ts2 = getComputedStyle(tab); if (ts2.display !== "none" && tb.height > 0 && r.bottom > tb.top + 0.5 && r.top < tb.bottom) out.push("sits on top of the bottom menu"); }
  }
  return { problems: out };
})`;

async function measure(page: Page, sel: string, opts: { fixed?: boolean; notOverMenu?: boolean } = {}) {
  return (await page.evaluate(`${MEASURE}(${JSON.stringify(sel)}, ${JSON.stringify(opts)})`)) as { missing?: true; problems?: string[] };
}

async function judge(page: Page, profile: string, item: string, sel: string, opts: { fixed?: boolean; notOverMenu?: boolean } = {}, shot = false) {
  const m = await measure(page, sel, opts);
  if (m.missing) { findings.push({ profile, item, problem: "did not appear" }); return false; }
  for (const p of [...new Set(m.problems)]) findings.push({ profile, item, problem: p });
  if (!m.problems?.length) passed.push(`${profile}: ${item}`);
  if (shot) {
    const file = `${profile.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}--${item.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`;
    await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 65, timeout: 10000 }).catch(() => {});
    shots.push(file);
  }
  return true;
}

async function gone(page: Page, profile: string, item: string, sel: string) {
  const left = await page.waitForSelector(sel, { state: "detached", timeout: 4000 }).then(() => false).catch(async () => (await page.locator(sel).count()) > 0 && (await page.locator(sel).first().isVisible().catch(() => false)));
  if (left) findings.push({ profile, item, problem: "did not close" });
}

async function run() {
  const session = execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" }).trim().split("\n");
  const seeker = session[2];
  const browsers: Record<string, Browser> = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const reduced = process.env.STATES_MOTION === "on" ? "no-preference" : "reduce";
  for (const prof of PROFILES) {
    const ctx = await browsers[prof.engine].newContext({ ...prof.opts, locale: "en-NG", timezoneId: "Africa/Lagos", reducedMotion: reduced });
    await ctx.addInitScript({ content: "Object.defineProperty(navigator, 'webdriver', { get: function () { return false; } }); try { localStorage.setItem('intro-done', '1'); } catch (e) {}" });
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }, { name: "cookie_choice", value: "essential", domain: new URL(BASE).hostname, path: "/" }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
    const open = async () => { await page.goto(BASE + "/qa/states", { waitUntil: "load" }); await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1", null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); };
    const P = prof.name, S = !!prof.shots;
    try {
      await open();
      const side = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      if (side) findings.push({ profile: P, item: "page", problem: "the page scrolls sideways" });
      // Messages on a page.
      for (const q of ["flash-notice", "flash-error", "flash-warn", "flash-plain", "field-error", "empty"]) await judge(page, P, `message: ${q}`, `[data-qa="${q}"]`);
      await page.locator('[data-qa="messages"]').scrollIntoViewIfNeeded().catch(() => {});
      if (S) { await page.screenshot({ path: `${OUT}/${P.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}--page-messages.jpg`, type: "jpeg", quality: 65, fullPage: false }).catch(() => {}); shots.push(`${P.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}--page-messages.jpg`); }

      // Pop-up messages (toasts): success, error, warning, info.
      for (const kind of ["success", "error", "warning", "info"]) {
        await page.locator(`[data-qa="toast-${kind}"]`).click();
        await page.waitForSelector("[data-sonner-toast]", { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await judge(page, P, `pop-up message: ${kind}`, "[data-sonner-toast]", { fixed: true, notOverMenu: true }, S && kind === "success");
        const close = page.locator("[data-sonner-toast] [data-close-button]").first();
        if (await close.count()) await close.click().catch(() => {}); else await page.keyboard.press("Escape");
        await gone(page, P, `pop-up message: ${kind}`, "[data-sonner-toast]");
      }

      // Confirmation windows.
      for (const q of ["confirm-danger", "confirm-default"]) {
        await page.locator(`[data-qa="${q}"]`).click();
        await page.waitForSelector("dialog.cfm[open]", { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
        await judge(page, P, `window: ${q}`, "dialog.cfm[open]", { fixed: true }, S && q === "confirm-danger");
        await page.keyboard.press("Escape");
        await gone(page, P, `window: ${q}`, "dialog.cfm[open]");
      }

      // The account switch window (Escape takes the person back where they were: a reload here).
      await page.locator('[data-qa="switch"]').click();
      await page.waitForSelector("dialog.switch[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      await judge(page, P, "window: account switch", "dialog.switch[open]", { fixed: true }, S);
      await open();

      // "Working…" steps.
      await page.locator('[data-qa="veil"]').click();
      await page.waitForSelector('[data-qa="veil-box"]', { timeout: 3000 }).catch(() => {});
      await judge(page, P, "window: working steps", '[data-qa="veil-box"] .cfm-inner', { fixed: true });
      await page.waitForTimeout(4200);

      // The "parts of this page did not load" bar.
      await page.locator('[data-qa="health"]').click();
      await page.waitForSelector("#js-health", { timeout: 3000 }).catch(() => {});
      await judge(page, P, "bar: page problem", "#js-health", { fixed: true, notOverMenu: true }, S);
      await page.locator("#js-health button[aria-label='Close']").click().catch(() => {});
      await gone(page, P, "bar: page problem", "#js-health");

      // The share window.
      await page.locator('[data-qa="share"] button').first().click();
      await page.waitForSelector("dialog.share-sheet[open]", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      await judge(page, P, "window: share", "dialog.share-sheet[open]", { fixed: true }, S);
      await page.keyboard.press("Escape");
      await gone(page, P, "window: share", "dialog.share-sheet[open]");

      // Notifications panel (the bell) and the assistant panel.
      const bell = page.locator(".bell-btn").first();
      if (await bell.isVisible().catch(() => false)) {
        await bell.click();
        await page.waitForSelector(".bell-panel", { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        await judge(page, P, "panel: notifications", ".bell-panel", { fixed: true }, S);
        await page.keyboard.press("Escape");
        await bell.click().catch(() => {});
      }
      const fab = page.locator(".ai-fab").first();
      if (await fab.isVisible().catch(() => false)) {
        await judge(page, P, "button: assistant", ".ai-fab", { notOverMenu: true });
        await fab.click();
        await page.waitForSelector(".ai-panel", { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(400);
        await judge(page, P, "panel: assistant", ".ai-panel", { fixed: true }, S); // full screen on phones, on purpose
        await page.locator(".ai-x").click().catch(() => {});
        await gone(page, P, "panel: assistant", ".ai-panel");
      }

      // The welcome slides.
      await page.goto(BASE + "/qa/states?intro=1", { waitUntil: "load" });
      await page.waitForSelector(".intro", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(600);
      await judge(page, P, "window: welcome slides", ".intro", { fixed: true }, S);

      // The cookie choice, as a first-time visitor sees it: on screen, above the bottom menu, buttons 44px, and gone once chosen.
      await ctx.clearCookies({ name: "cookie_choice" });
      await page.goto(BASE + "/qa/states", { waitUntil: "load" });
      await page.waitForSelector(".cookie-notice", { timeout: 6000 }).catch(() => {});
      if (await judge(page, P, "window: cookie choice", ".cookie-notice", { fixed: true, notOverMenu: true }, S)) {
        await page.locator(".cookie-notice button", { hasText: "Essential only" }).click().catch(() => {});
        await gone(page, P, "window: cookie choice", ".cookie-notice");
        const saved = (await ctx.cookies()).find((c) => c.name === "cookie_choice")?.value;
        if (saved !== "essential") findings.push({ profile: P, item: "window: cookie choice", problem: "the choice was not remembered" });
      }
      if (errors.length) findings.push({ profile: P, item: "page", problem: `script error: ${errors[0]}` });
    } catch (e) {
      findings.push({ profile: P, item: "check", problem: `the check itself stopped: ${(e as Error).message.split("\n")[0].slice(0, 160)}` });
    }
    await ctx.close();
    console.log(`${P}: ${findings.filter((f) => f.profile === P).length} problem(s)`);
  }
  await Promise.all(Object.values(browsers).map((b) => b.close()));

  const byItem = new Map<string, Finding[]>();
  for (const f of findings) byItem.set(`${f.item} — ${f.problem}`, [...(byItem.get(`${f.item} — ${f.problem}`) ?? []), f]);
  const md = [
    "# Messages and windows on every screen", "",
    `${PROFILES.length} screen sizes: ${PROFILES.map((p) => p.name).join(", ")}.`, "",
    findings.length ? `**${findings.length} problem(s)**` : "**No problems.**", "",
    ...[...byItem].map(([k, fs]) => `- ${k} | ${[...new Set(fs.map((f) => f.profile))].join(", ")}`), "",
    `${passed.length} checks passed.`, "",
    "## Pictures", "", ...shots.map((s) => `- [${s}](${s})`), "",
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, md);
  writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
  console.log(md);
  if (findings.length && process.env.STATES_STRICT !== "false") process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
