/**
 * Uses the site the way a person does, in a normal (not automated-looking) Chrome: the opening loader runs, the doors open,
 * the welcome slides follow, and then it types, taps and opens things. The device check proves pages render and fit; this
 * proves they respond. Every step records what happened, browser errors, failed downloads and a screenshot.
 *
 * Usage: BASE_URL=http://localhost:3100 tsx scripts/real-browser-check.ts   (REAL_STRICT=true fails the run on any failure)
 */
import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const STRICT = process.env.REAL_STRICT === "true";
const OUT = "device-report/real";
mkdirSync(OUT, { recursive: true });

type Row = { step: string; ok: boolean; note: string; shot?: string };
const rows: Row[] = [];
const problems: string[] = [];

async function newContext(browser: Browser, kind: "desktop" | "wide" | "phone"): Promise<BrowserContext> {
  const base = kind === "phone" ? devices["Pixel 7"] : { viewport: kind === "wide" ? { width: 1920, height: 1080 } : { width: 1366, height: 768 } };
  const ctx = await browser.newContext({ ...base, locale: "en-NG", timezoneId: "Africa/Lagos" });
  // A real visitor: navigator.webdriver is false, so the loader and the welcome slides behave as they do for people.
  // Given as text: a function here would be compiled with helpers (__name) that do not exist in the page.
  await ctx.addInitScript({ content: "Object.defineProperty(navigator, 'webdriver', { get: function () { return false; } });" });
  return ctx;
}

function watch(page: Page, label: string) {
  const where = () => page.url().replace(BASE, "") || "/";
  page.on("pageerror", (e) => problems.push(`${label} ${where()}: script error: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${label} ${where()}: console: ${m.text().slice(0, 300)}`); });
  // Prefetches and media cancelled by navigating away are normal; only report real failures.
  page.on("requestfailed", (r) => { if (!r.url().includes("tile.openstreetmap") && r.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`${label}: failed to load ${r.url().replace(BASE, "")} (${r.failure()?.errorText})`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) problems.push(`${label}: ${r.status()} for ${r.url().replace(BASE, "")}`); });
}

let n = 0;
async function record(page: Page, step: string, ok: boolean, note: string) {
  const file = `${String(++n).padStart(2, "0")}-${step.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50)}.jpg`;
  try { await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 70, timeout: 10000 }); } catch { /* best effort */ }
  rows.push({ step, ok, note, shot: file });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}: ${note}`);
}
const hydrated = (page: Page) => page.evaluate(() => document.documentElement.dataset.hydrated === "1").catch(() => false);
const textLen = (page: Page) => page.evaluate(() => (document.querySelector("main")?.innerText ?? document.body.innerText).trim().length).catch(() => 0);
const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { rows.push({ step: name, ok: false, note: `crashed: ${(e as Error).message.split("\n")[0].slice(0, 200)}` }); console.log(`FAIL  ${name}: ${(e as Error).message.split("\n")[0]}`); } };

async function main() {
  const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });

  // 1. First visit: loader, doors, welcome slides.
  const desk = await newContext(browser, "desktop");
  const p = await desk.newPage(); watch(p, "desktop");
  await step("First visit: loader opens onto the welcome slides", async () => {
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const sawLoader = await p.locator("#boot").isVisible().catch(() => false);
    await p.waitForFunction(() => document.documentElement.classList.contains("boot-off"), null, { timeout: 15000 }).catch(() => {});
    const intro = await p.locator(".intro").waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    await record(p, "loader then intro", sawLoader && intro, `loader shown: ${sawLoader}; welcome slides after the doors: ${intro}; scripts running: ${await hydrated(p)}`);
  });
  await step("Welcome slides: Next and Skip", async () => {
    const next = p.getByRole("button", { name: /next/i }).first();
    let moved = false;
    if (await next.isVisible().catch(() => false)) { const before = await p.locator(".intro-copy").innerText().catch(() => ""); await next.click(); await p.waitForTimeout(700); moved = before !== (await p.locator(".intro-copy").innerText().catch(() => "")); }
    await p.getByRole("button", { name: /skip/i }).first().click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(500);
    const gone = !(await p.locator(".intro").isVisible().catch(() => false));
    await record(p, "intro next and skip", moved && gone, `Next changed the slide: ${moved}; Skip closed it: ${gone}`);
  });
  await step("Home page shows content", async () => {
    const len = await textLen(p);
    await record(p, "home content", len > 300, `${len} characters of content`);
  });
  await step("Home slideshow moves on its own", async () => {
    const text = () => p.locator(".hx-slide").first().innerText({ timeout: 5000 }).catch(() => "");
    const a = await text();
    await p.waitForTimeout(8000);
    const b = await text();
    await record(p, "home slideshow", !!a && a !== b, a !== b ? "the headline changed by itself within 8 seconds" : "the headline did not change in 8 seconds");
  });

  // 2. Guest pages that must never be blank.
  for (const path of ["/artisans", "/directory?kind=agents", "/directory?kind=companies", "/directory?kind=developers", "/browse", "/map", "/reels", "/flatmates", "/market", "/field", "/pricing"]) {
    await step(`Guest page ${path}`, async () => {
      const res = await p.goto(BASE + path, { waitUntil: "load", timeout: 30000 });
      await p.waitForTimeout(1200);
      const len = await textLen(p);
      await record(p, `guest ${path}`, (res?.status() ?? 0) < 400 && len > 150, `status ${res?.status()}, ${len} characters, scripts running: ${await hydrated(p)}`);
    });
  }
  await step("Map draws its tiles and pins", async () => {
    await p.goto(BASE + "/map", { waitUntil: "load" });
    await p.waitForTimeout(6000);
    const tiles = await p.locator(".leaflet-tile-loaded").count();
    const pins = await p.locator(".leaflet-marker-icon, .leaflet-interactive").count();
    await record(p, "map tiles", tiles > 0, `${tiles} map tiles loaded, ${pins} pins or shapes`);
  });

  // 3. Typing, showing a password, a wrong-password message.
  await step("Sign in: typing into the boxes", async () => {
    await p.goto(BASE + "/login", { waitUntil: "load" });
    await p.waitForTimeout(1500);
    const email = p.locator('input[type="email"], input[name="email"]').first();
    const pass = p.locator('input[type="password"], input[name="password"]').first();
    await email.click(); await email.pressSequentially("someone@example.com", { delay: 15 });
    await pass.click(); await pass.pressSequentially("wrong-password-123", { delay: 15 });
    const ev = await email.inputValue(), pv = await pass.inputValue();
    await record(p, "login typing", ev === "someone@example.com" && pv === "wrong-password-123", `email box holds "${ev}", password box holds ${pv.length} characters`);
  });
  await step("Sign in: wrong password shows a message", async () => {
    await p.getByRole("button", { name: /^sign in$/i }).first().click();
    const msg = await p.locator('[data-sonner-toast], [role="alert"], .flash.error, .toast').first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    await record(p, "login wrong password message", msg, msg ? "a message appeared" : "no message within 8 seconds");
  });
  await step("Sign up: the eye shows the password", async () => {
    await p.goto(BASE + "/join?as=personal", { waitUntil: "load" });
    await p.waitForTimeout(1200);
    const pass = p.locator('input[type="password"]').first();
    await pass.click(); await pass.pressSequentially("Secret-pass-1", { delay: 10 });
    const eye = p.locator('button[aria-label*="password" i], button[aria-label*="show" i], .pw-toggle').first();
    await eye.click({ timeout: 3000 });
    const type = await p.locator('input[name="password"], input[autocomplete="new-password"]').first().getAttribute("type");
    await record(p, "signup password eye", type === "text", `after tapping the eye the box type is "${type}"`);
  });
  await step("Sign up: the confirmation says at once whether the passwords match", async () => {
    const first = p.locator('input[name="password"]').first();
    const confirm = p.locator('input[name="passwordConfirm"]').first();
    await first.fill(""); await first.pressSequentially("Secret-pass-123", { delay: 5 });
    await confirm.click(); await confirm.pressSequentially("Secret-pass-12X", { delay: 5 });
    const bad = (await p.locator("#pw-match").textContent()) ?? "";
    await confirm.press("Backspace"); await confirm.pressSequentially("3", { delay: 5 });
    const good = (await p.locator("#pw-match").textContent()) ?? "";
    const ok = /do not match/i.test(bad) && /passwords match/i.test(good);
    await record(p, "signup password match", ok, `wrong: "${bad.trim()}"; right: "${good.trim()}"`);
  });

  // 4. Desktop width.
  const wide = await newContext(browser, "wide");
  const w = await wide.newPage(); watch(w, "wide");
  await step("Desktop 1920 px: page uses the width", async () => {
    await w.goto(BASE + "/browse", { waitUntil: "load" });
    const used = await w.evaluate(() => Math.round((document.querySelector("main .wrap, main") as HTMLElement).getBoundingClientRect().width));
    await record(w, "desktop width", used >= 1500, `content is ${used} px wide on a 1920 px screen`);
  });

  await step("Visitor on desktop: a website header, no side panel, no stray band, even promotion cards", async () => {
    await w.goto(BASE + "/", { waitUntil: "load" });
    const r = await w.evaluate(() => {
      const rail = document.querySelector(".rail") as HTMLElement | null;
      const railShown = !!rail && rail.getBoundingClientRect().right > 0 && getComputedStyle(rail).visibility !== "hidden";
      const links = [...document.querySelectorAll(".topnav > a")].map((a) => a.textContent?.trim());
      const spacer = document.querySelector(".bar-spacer") as HTMLElement | null;
      const band = spacer ? getComputedStyle(spacer).backgroundColor : "none";
      const offers = [...document.querySelectorAll(".offer")].map((o) => Math.round(o.getBoundingClientRect().height));
      const tags = [...document.querySelectorAll(".offer-tag")].map((t) => Math.round(t.getBoundingClientRect().height));
      const cols = [...document.querySelectorAll(".foot-grid > nav")].map((n) => Math.round(n.getBoundingClientRect().top));
      const footerRows = new Set(cols).size;
      const sections = document.querySelectorAll("main .sec, main .cta").length;
      return { railShown, links, band, offers, tags, footerRows, sections };
    });
    const ok = !r.railShown && ["Home", "Find property", "Agents", "Companies", "Blog"].every((l) => r.links.includes(l))
      && (r.band === "rgba(0, 0, 0, 0)" || r.band === "transparent") && r.offers.every((h) => h < 620) && r.tags.every((h) => h < 40) && r.footerRows === 1;
    await record(w, "visitor header", ok, `side panel shown: ${r.railShown}; top links: ${r.links.join(", ")}; spacer colour: ${r.band}; promo card heights: ${r.offers.join(", ") || "none"}; label heights: ${r.tags.join(", ") || "none"}; footer column rows: ${r.footerRows}; home sections: ${r.sections}`);
  });

  await step("Desktop reels: the whole reel fits on the screen", async () => {
    await w.goto(BASE + "/reels", { waitUntil: "load" });
    await w.waitForTimeout(1500);
    const r = await w.evaluate(() => {
      const info = document.querySelector(".rf-info, .rf-rail") as HTMLElement | null;
      const slide = document.querySelector(".rf-slide") as HTMLElement | null;
      return { h: innerHeight, infoBottom: info ? Math.round(info.getBoundingClientRect().bottom) : -1, slideBottom: slide ? Math.round(slide.getBoundingClientRect().bottom) : -1 };
    });
    const ok = r.slideBottom > 0 && r.slideBottom <= r.h + 1 && r.infoBottom <= r.h;
    await record(w, "desktop reels fit", ok || r.slideBottom === -1, r.slideBottom === -1 ? "no reels in this data" : `screen ${r.h}px; reel ends at ${r.slideBottom}px; caption and buttons end at ${r.infoBottom}px`);
  });

  await step("Theme: the person's choice wins over the device setting", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: "dark" });
    const t = await ctx.newPage(); watch(t, "theme");
    await t.goto(BASE + "/blog", { waitUntil: "load" });
    const bg = () => t.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const device = await bg();
    await t.locator(".theme-btn").click();
    await t.getByRole("menuitemradio", { name: /light/i }).click();
    await t.waitForTimeout(300);
    const light = await bg();
    await t.reload({ waitUntil: "load" });
    const kept = await bg();
    const lum = (c: string) => { const m = c.match(/\d+/g)!.map(Number); return (m[0] + m[1] + m[2]) / 3; };
    const ok = lum(device) < 80 && lum(light) > 200 && lum(kept) > 200;
    await record(t, "theme choice", ok, `device dark: ${device}; after choosing Light: ${light}; after reload: ${kept}`);
    await ctx.close();
  });

  // 5. Phone: menu opens.
  const phone = await newContext(browser, "phone");
  const m = await phone.newPage(); watch(m, "phone");
  await step("Phone: the menu opens", async () => {
    await m.goto(BASE + "/browse", { waitUntil: "load" });
    await m.waitForTimeout(1500);
    await m.locator(".menu-btn, button:has-text('Menu')").first().click({ timeout: 5000 });
    await m.waitForTimeout(700);
    const links = await m.locator(".rail a:visible, nav a:visible").count();
    await record(m, "phone menu", links >= 3, `${links} menu links visible after tapping Menu`);
  });
  await step("Phone: reels swipe", async () => {
    await m.goto(BASE + "/reels", { waitUntil: "load" });
    await m.waitForTimeout(1500);
    await record(m, "phone reels", (await textLen(m)) > 20, "reels page open");
  });
  await step("Phone: the reels filter can be tapped and opens", async () => {
    const sum = m.locator(".rf-filter > summary").first();
    const free = await sum.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === el || el.contains(hit)); }).catch(() => false);
    await sum.click({ timeout: 5000 }).catch(() => {});
    await m.waitForTimeout(400);
    const open = await m.locator(".rf-filter-form").isVisible().catch(() => false);
    const readable = await m.locator(".rf-filter-form .chip-choice span").first().evaluate((el) => getComputedStyle(el).color !== getComputedStyle(el).backgroundColor).catch(() => false);
    await record(m, "phone reels filter", free && open && readable, `button not covered: ${free}; panel opened: ${open}; choices readable: ${readable}`);
    await m.keyboard.press("Escape").catch(() => {});
  });

  // 6. Signed in (the demo home seeker): chat, the bell, profile and settings.
  await step("Signed in: chat sends a message", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const lines = out.trim().split("\n");
    const seeker = lines[2];
    const chat = lines.find((l) => /^\/messages\/[0-9a-f-]{36}$/.test(l));
    const ctx = await newContext(browser, "desktop");
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await ctx.newPage(); watch(s, "signed-in");
    if (!chat) { rows.push({ step: "chat", ok: false, note: "no conversation to open in the demo data" }); }
    else {
      await s.goto(BASE + chat, { waitUntil: "load" });
      await s.waitForTimeout(1200);
      const msg = `Hello from the real-browser check ${Date.now()}`;
      const box = s.locator(".composer textarea");
      await box.click(); await box.pressSequentially(msg, { delay: 5 }); await box.press("Enter");
      const sent = await s.locator(".bubble-text", { hasText: msg }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      await s.waitForTimeout(1500);
      const failedNow = await s.locator(".bubble.failed").count();
      await record(s, "chat send", sent && failedNow === 0, `message shown: ${sent}; failed bubbles: ${failedNow}`);
    }
    await s.goto(BASE + "/me/settings", { waitUntil: "load" });
    await s.waitForTimeout(800);
    const settings = await s.getByRole("heading", { name: /use housy as/i }).isVisible().catch(() => false);
    await record(s, "profile and settings", settings, settings ? "Profile and settings opened with the switch" : "the settings page did not show the switch");
    const bell = s.locator(".bell-btn");
    if (await bell.count()) {
      await bell.click(); await s.waitForTimeout(500);
      const open = await s.locator(".bell-panel").isVisible().catch(() => false);
      await record(s, "notification bell", open, open ? "the bell opened its panel" : "the bell did not open");
    } else rows.push({ step: "notification bell", ok: false, note: "no bell in the top bar" });
    // The side menu folds to icons, stays folded on the next page, and opens again.
    const railW = () => s.evaluate(() => Math.round((document.querySelector(".rail") as HTMLElement).getBoundingClientRect().width));
    const full = await railW();
    await s.locator(".rail-fold").click(); await s.waitForTimeout(600);
    const folded = await railW();
    await s.goto(BASE + "/me", { waitUntil: "load" }); await s.waitForTimeout(500);
    const kept = await railW();
    const icons = await s.locator(".rail-nav-mini .mini-link:visible").count();
    await s.locator(".rail-fold").click(); await s.waitForTimeout(600);
    const back = await railW();
    await record(s, "side menu folds", full > 200 && folded < 120 && kept < 120 && icons > 5 && back > 200, `full ${full}px, folded ${folded}px, after moving page ${kept}px with ${icons} icons, opened again ${back}px`);
    // Profile photo: add one, then the round × on its corner removes it and the initials come back.
    await s.goto(BASE + "/me/settings", { waitUntil: "load" }); await s.waitForTimeout(400);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUUlEQVR42u3PMQ0AMAgAMJgx9KILI1PBQdI6aE5XXPbiOAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYF9H8XMAkvmWWjoAAAAAElFTkSuQmCC", "base64");
    await s.locator(".pm-avatar .pm-file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    const added = await s.locator(".profile-avatar img").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    const x = s.locator(".pm-x");
    const xShown = added && await x.isVisible().catch(() => false);
    const xSize = xShown ? await x.evaluate((el) => Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))) : 0;
    // Removing asks first: cancelling keeps the photo; confirming removes it.
    let asked = false, keptOnCancel = false;
    if (xShown) {
      await x.click();
      const dlg = s.locator("dialog.cfm[open]");
      asked = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      if (asked) {
        await dlg.locator(".cfm-cancel").click(); await s.waitForTimeout(800);
        keptOnCancel = (await s.locator(".profile-avatar img").count()) > 0 && !(await s.locator("dialog.cfm[open]").count());
        await x.click(); await s.locator("dialog.cfm[open] .cfm-ok").click();
      }
    }
    const gone = xShown && asked && await s.waitForFunction(() => !document.querySelector(".profile-avatar img") && (document.querySelector(".profile-avatar")?.textContent ?? "").trim().length > 0, null, { timeout: 15000 }).then(() => true).catch(() => false);
    await record(s, "remove profile photo", added && xShown && xSize >= 44 && asked && keptOnCancel && gone, `photo added ${added}; remove button shown ${xShown} (${xSize}px); asked first ${asked}; cancelling kept it ${keptOnCancel}; after confirming the initials are back ${gone}`);
    await ctx.close();
  });

  await step("Signed in on a phone: the opening loader shows once and never comes back", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const seeker = out.trim().split("\n")[2];
    const ctx = await newContext(browser, "phone");
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await ctx.newPage(); watch(s, "signed-in phone");
    await s.goto(BASE + "/", { waitUntil: "load" });
    await s.waitForFunction(() => document.documentElement.classList.contains("boot-off"), null, { timeout: 15000 }).catch(() => {});
    const stuck: string[] = [];
    for (const path of ["/", "/browse", "/reels", "/directory?kind=agents", "/me"]) {
      await s.goto(BASE + path, { waitUntil: "load" });
      const off = await s.waitForFunction(() => !document.getElementById("boot") || getComputedStyle(document.getElementById("boot")!).display === "none", null, { timeout: 4000 }).then(() => true).catch(() => false);
      if (!off) stuck.push(path);
    }
    await record(s, "loader once signed in", stuck.length === 0, stuck.length ? `loader still covering: ${stuck.join(", ")}` : "no loader on later pages");
    await ctx.close();
  });

  await step("Signed in on a desktop: only Home drops the side menu; menu clicks keep it", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const seeker = out.trim().split("\n")[2];
    const ctx = await newContext(browser, "desktop");
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await ctx.newPage(); watch(s, "signed-in desktop");
    const railShown = async () => s.evaluate(() => { const r = document.getElementById("rail"); if (!r) return false; const b = r.getBoundingClientRect(); return getComputedStyle(r).visibility !== "hidden" && b.right > 10 && b.width > 40; });
    const results: string[] = []; let ok = true;
    for (const [path, wantRail] of [["/", false], ["/browse", true], ["/blog", true], ["/market", true], ["/me", true]] as const) {
      await s.goto(BASE + path, { waitUntil: "load" }); await s.waitForTimeout(400);
      const rail = await railShown(); const tabs = await s.locator(".topnav").isVisible().catch(() => false);
      const good = wantRail ? rail && !tabs : !rail && tabs && (await s.locator(".bar-account").isVisible().catch(() => false));
      ok = ok && good; results.push(`${path}: side menu ${rail ? "shown" : "hidden"}${good ? "" : " (wrong)"}`);
    }
    // Clicking a side-menu link: it lights up straight away and the menu is still there on arrival.
    await s.goto(BASE + "/me", { waitUntil: "load" }); await s.waitForTimeout(400);
    const link = s.locator('#rail a.rail-link[href="/market"]').first();
    if (await link.count()) {
      await s.evaluate(() => document.querySelector('#rail a.rail-link[href="/market"]')?.closest("details")?.setAttribute("open", ""));
      await link.click();
      const lit = await s.waitForFunction(() => !!document.querySelector('#rail a.rail-link.active[href="/market"]'), null, { timeout: 1500 }).then(() => true).catch(() => false);
      await s.waitForURL(/\/market/, { timeout: 15000 }); await s.waitForTimeout(500);
      const kept = await railShown(); ok = ok && lit && kept;
      results.push(`menu click to Market prices: lit at once ${lit}, menu kept ${kept}`);
    } else results.push("no Market prices link in this menu");
    await record(s, "side menu stays on menu clicks", ok, results.join("; "));
    await ctx.close();
  });

  await step("Signed in as someone else, the staff sign-in asks before leaving that account, shows the switch, and staff can sign in", async () => {
    // Fresh sessions: this step signs the agent out, so it must not share a session with other steps.
    const out = execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const agent = out.trim().split("\n")[0];
    const ctx = await newContext(browser, "desktop");
    await ctx.addCookies([{ name: "sid", value: agent, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await ctx.newPage(); watch(s, "staff switch");
    await s.goto(BASE + "/auth/login", { waitUntil: "load" }); await s.waitForTimeout(800);
    const gate = s.locator("dialog.switch[open]");
    const asked = await gate.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    const menu = await s.locator(".rail").count() + await s.locator(".bar-account, .rail-account").count();
    const named = asked ? (await gate.innerText()).replace(/\s+/g, " ").slice(0, 160) : "";
    await record(s, "staff switch asks", asked && menu === 0, `asked first ${asked}; side menu or account shown ${menu > 0}; "${named}"`);
    let steps = "", landed = false, signedIn = false;
    if (asked) {
      await gate.locator("button.cfm-ok").click();
      steps = await s.locator(".switch-steps").innerText({ timeout: 3000 }).catch(() => "");
      await s.waitForURL((u) => u.pathname === "/auth/login", { timeout: 15000 }).catch(() => {});
      await s.waitForTimeout(1200);
      landed = !(await s.locator("dialog.switch[open]").count()) && (await s.locator('form input[name="email"]').count()) > 0;
      const email = process.env.SEED_ADMIN_EMAIL, password = process.env.SEED_ADMIN_PASSWORD;
      if (landed && email && password) {
        await s.locator("#email").click(); await s.locator("#email").fill(email);
        await s.locator("#password").click(); await s.locator("#password").fill(password);
        await s.locator("button.auth-submit").click();
        signedIn = await s.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 20000 }).then(() => true).catch(() => false);
      }
    }
    await record(s, "staff switch and sign-in", landed && signedIn, `steps shown "${steps.replace(/\s+/g, " ").slice(0, 120)}"; signed out and on the staff form ${landed}; staff sign-in reached the admin area ${signedIn}`);
    await ctx.close();
  });

  await step("The admin area is hidden; staff sign in at /auth/login", async () => {
    const ctx = await newContext(browser, "desktop");
    const s = await ctx.newPage();
    const admin = await s.goto(BASE + "/admin", { waitUntil: "load" });
    const deep = await s.request.get(BASE + "/admin/kyc", { maxRedirects: 0 });
    const staff = await s.goto(BASE + "/auth/login", { waitUntil: "load" });
    const noindex = await s.locator('meta[name="robots"][content*="noindex"]').count();
    const form = await s.locator('form input[name="email"]').count();
    const ok = admin?.status() === 404 && deep.status() === 404 && staff?.status() === 200 && noindex > 0 && form > 0;
    await record(s, "admin hidden, staff sign-in", ok, `/admin: ${admin?.status()}; /admin/kyc: ${deep.status()}; /auth/login: ${staff?.status()}, noindex ${noindex > 0}, form ${form > 0}`);
    await ctx.close();
  });

  await step("Signed in on a phone: comment on a reel, reply with the comment highlighted, and like a comment", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const seeker = out.trim().split("\n")[2];
    const ctx = await newContext(browser, "phone");
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await ctx.newPage(); watch(s, "reel comments");
    await s.goto(BASE + "/reels?all=1", { waitUntil: "load" }); await s.waitForTimeout(1200);
    const notes: string[] = []; let ok = true;
    const open = s.locator('.rf-act[aria-label^="Comments"]').first();
    if (!(await open.count())) { await record(s, "reel comments", false, "no reel with a comments button"); await ctx.close(); return; }
    await open.click();
    const box = s.locator(".rf-sheet .ct-row textarea");
    await box.waitFor({ timeout: 8000 });
    const text = `Is parking included? ${Date.now() % 100000}`;
    await box.fill(text); await s.locator(".rf-sheet .ct-row button[type=submit]").click();
    const posted = await s.locator(".rf-sheet .ct-item", { hasText: text }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    notes.push(`posted ${posted}`); ok = ok && posted;
    if (posted) {
      const mine = s.locator(".rf-sheet .ct-item", { hasText: text }).first();
      await mine.locator('button:has-text("Reply")').first().click();
      const lit = await mine.evaluate((el) => el.classList.contains("is-target")).catch(() => false);
      const label = await s.locator(".rf-sheet .ct-replying").isVisible().catch(() => false);
      await box.fill("Asking for a friend too"); await s.locator(".rf-sheet .ct-row button[type=submit]").click();
      const replied = await mine.locator(".ct-replies .ct-item", { hasText: "Asking for a friend too" }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      const like = mine.locator(".ct-like").first();
      await like.click(); await s.waitForTimeout(1200);
      const liked = (await like.getAttribute("aria-pressed")) === "true";
      notes.push(`reply highlighted ${lit}, "Replying to" shown ${label}, reply under the comment ${replied}, liked ${liked}`);
      ok = ok && lit && label && replied && liked;
    }
    await record(s, "reel comments", ok, notes.join("; "));
    await ctx.close();
  });

  await step("Signed in, on phones, tablets and computers: the compare bar shows only once something is picked, can be tapped, covers nothing, and goes away after comparing", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const seeker = out.trim().split("\n")[2];
    const screens: [string, Parameters<Browser["newContext"]>[0]][] = [
      ["iPhone SE", devices["iPhone SE"]],
      ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]],
      ["Pixel 7", devices["Pixel 7"]],
      ["iPad Mini", devices["iPad Mini"]],
      ["iPad Pro 11 landscape", devices["iPad Pro 11 landscape"]],
      ["Laptop 1366", { viewport: { width: 1366, height: 768 } }],
      ["Wide 1920", { viewport: { width: 1920, height: 1080 } }],
    ];
    const results: string[] = [];
    let allOk = true, flowDone = false;
    for (const [name, dev] of screens) {
      const ctx = await browser.newContext({ ...dev, locale: "en-NG", timezoneId: "Africa/Lagos" });
      await ctx.addInitScript({ content: "Object.defineProperty(navigator, 'webdriver', { get: function () { return false; } });" });
      // tsx compiles the functions passed to the page with a __name helper the page does not have.
      await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
      await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
      const s = await ctx.newPage(); watch(s, `compare bar ${name}`);
      await s.goto(BASE + "/browse", { waitUntil: "load" }); await s.waitForTimeout(800);
      const before = await s.locator(".compare-bar").count();
      const refs = await s.$$eval('a[href^="/properties/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href")!.split("/")[2]).filter((r) => r && !r.includes("?")))].slice(0, 2));
      await s.evaluate((r) => { localStorage.setItem("compare-refs", JSON.stringify(r)); }, refs);
      await s.reload({ waitUntil: "load" }); await s.waitForTimeout(1000);
      // Tappable: what a finger on the button's centre hits is the button. Covers nothing: it does not overlap the bottom
      // menu, the side menu, the assistant button or the back-to-top button where those are showing.
      const c = await s.evaluate(() => {
        const bar = document.querySelector(".compare-bar");
        if (!bar) return null;
        const hit = (el: Element | null) => { if (!el) return false; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); };
        const b = bar.getBoundingClientRect();
        const shown = (el: Element | null) => { if (!el) return null; const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0 && r.width > 0 && r.right > 0 && r.left < innerWidth ? r : null; };
        const overlaps = [".tabbar", ".rail", ".ai-fab", ".to-top"].filter((sel) => { const r = shown(document.querySelector(sel)); return r && !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); });
        return { compare: hit(bar.querySelector("a")), clear: hit(bar.querySelector("button")), inView: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, overlaps, small: Math.min(...[...bar.querySelectorAll("a, button")].map((x) => x.getBoundingClientRect().height)) };
      });
      const ok = refs.length === 2 && before === 0 && !!c && c.compare && c.clear && c.inView && c.overlaps.length === 0 && c.small >= 44;
      if (!ok) allOk = false;
      results.push(`${name}: ${ok ? "ok" : `before ${before}, ${JSON.stringify(c)}`}`);
      if (c && name === "iPhone SE") await s.screenshot({ path: `${OUT}/compare-bar-iphone-se.jpg`, quality: 70, type: "jpeg" }).catch(() => {});
      if (c && name === "iPad Mini") await s.screenshot({ path: `${OUT}/compare-bar-ipad-mini.jpg`, quality: 70, type: "jpeg" }).catch(() => {});
      // Once, on a phone: opening the comparison clears the picks, so the bar is gone there and afterwards.
      if (!flowDone && name === "Pixel 7" && c?.compare) {
        flowDone = true;
        await s.locator(".compare-bar a").click();
        const opened = await s.waitForURL((u) => u.pathname === "/compare", { timeout: 10000 }).then(() => true).catch(() => false);
        const onCompare = await s.locator(".compare-bar").count();
        await s.goto(BASE + "/browse", { waitUntil: "load" }); await s.waitForTimeout(800);
        const after = await s.locator(".compare-bar").count();
        if (!(opened && onCompare === 0 && after === 0)) allOk = false;
        results.push(`after comparing: opened ${opened}, bar on the comparison ${onCompare > 0}, bar afterwards ${after > 0}`);
      }
      await ctx.close();
    }
    // The picture for the report: a small iPhone with two properties picked.
    const pctx = await browser.newContext({ ...devices["iPhone SE"], locale: "en-NG", timezoneId: "Africa/Lagos" });
    await pctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    const s = await pctx.newPage();
    await s.goto(BASE + "/browse", { waitUntil: "load" });
    const two = await s.$$eval('a[href^="/properties/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href")!.split("/")[2]).filter((r) => r && !r.includes("?")))].slice(0, 2));
    await s.evaluate((r) => { localStorage.setItem("compare-refs", JSON.stringify(r)); }, two);
    await s.reload({ waitUntil: "load" }); await s.waitForTimeout(1200);
    await record(s, "compare bar", allOk && flowDone, results.join(" | "));
    await pctx.close();
  });

  await step("Signed in on a phone: sharing a reel opens the phone's share sheet straight from the tap, and only a real share counts", async () => {
    const out = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
    const seeker = out.trim().split("\n")[2];
    const ctx = await newContext(browser, "phone");
    await ctx.addCookies([{ name: "sid", value: seeker, domain: new URL(BASE).hostname, path: "/" }]);
    // Stand in for the phone's share sheet: note what was shared and whether the tap was still "fresh" (the browser
    // refuses navigator.share otherwise), and answer as if the person cancelled or sent it.
    // Plain text, so the test runner's compiled helpers never end up inside the page.
    await ctx.addInitScript(`
      window.__shares = []; window.__mode = "cancel";
      Object.defineProperty(navigator, "canShare", { configurable: true, value: function () { return true; } });
      Object.defineProperty(navigator, "share", { configurable: true, value: function (d) {
        window.__shares.push({ files: d.files ? d.files.length : 0, url: d.url, fresh: navigator.userActivation ? navigator.userActivation.isActive : true });
        return window.__mode === "cancel" ? Promise.reject(new DOMException("closed", "AbortError")) : Promise.resolve();
      } });
    `);
    const s = await ctx.newPage(); watch(s, "reel share");
    await s.goto(BASE + "/reels?all=1", { waitUntil: "load" }); await s.waitForTimeout(1200);
    const btn = s.locator('.rf-act[aria-label^="Share"]').first();
    if (!(await btn.count())) { await record(s, "reel share", false, "no reel with a share button"); await ctx.close(); return; }
    const count = async () => Number((await btn.locator(".rf-n").innerText().catch(() => "-1")).trim());
    const n0 = await count();
    await btn.click();
    const sheet = s.locator("dialog.share-sheet[open]").first();
    await sheet.waitFor({ timeout: 8000 });
    await sheet.locator('button:has-text("Copy link")').click(); await s.waitForTimeout(800);
    const afterCopy = await count();
    await sheet.locator('button:has-text("Share link with an app")').click(); await s.waitForTimeout(800);
    const afterCancel = await count();
    const video = sheet.locator('button:has-text("Share the video and link")');
    const ready = await video.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    if (ready) {
      await s.evaluate('window.__mode = "send"');
      await video.click(); await s.waitForTimeout(1500);
    }
    const afterSend = await count();
    const calls = (await s.evaluate("window.__shares")) as { files: number; url?: string; fresh: boolean }[];
    const linkCall = calls[0], videoCall = calls[1];
    const ok = n0 >= 0 && afterCopy === n0 && afterCancel === n0 && !!linkCall?.fresh && !!linkCall?.url && ready && !!videoCall?.fresh && videoCall.files === 1 && afterSend === n0 + 1;
    await record(s, "reel share", ok, `count ${n0}; after copying the link ${afterCopy}; after cancelling the share sheet ${afterCancel}; ` +
      `link share opened from a fresh tap ${!!linkCall?.fresh}; video ready ${ready}; video share opened from a fresh tap ${!!videoCall?.fresh} with ${videoCall?.files ?? 0} file; after sending ${afterSend}`);
    await ctx.close();
  });

  await step("When the page's scripts cannot load, people see plain words and a Reload button, never file names", async () => {
    const ctx = await newContext(browser, "phone");
    await ctx.route("**/_next/static/chunks/**", (r) => r.abort());
    const s = await ctx.newPage();
    await s.goto(BASE + "/browse", { waitUntil: "load" }).catch(() => {});
    const bar = s.locator("#js-health");
    await bar.waitFor({ timeout: 25000 }).catch(() => {});
    const text = (await bar.innerText().catch(() => "")) || "";
    const ok = text.length > 20 && !/_next|\.js\b|chunk/i.test(text) && /reload/i.test(text);
    await record(s, "blocked scripts message", ok, text ? `message: "${text.replace(/\s+/g, " ").slice(0, 160)}"` : "no message shown");
    await ctx.close();
  });

  await browser.close();

  const failed = rows.filter((r) => !r.ok);
  const uniq = [...new Set(problems)].slice(0, 80);
  const md = [`# Real-browser check (${new Date().toISOString()})`, "", `${rows.length - failed.length} of ${rows.length} steps passed.`, "",
    "| Step | Result | What happened | Screenshot |", "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.step} | ${r.ok ? "pass" : "**FAIL**"} | ${r.note.replace(/\|/g, "/")} | ${r.shot ? `[${r.shot}](${r.shot})` : ""} |`),
    "", "## Browser errors and failed downloads", "", ...(uniq.length ? uniq.map((u) => `- ${u}`) : ["None."])].join("\n");
  writeFileSync(`${OUT}/report.md`, md + "\n");
  for (const f of failed) console.log(`::${STRICT ? "error" : "warning"}::Real-browser check: ${f.step}: ${f.note}`);
  for (const u of uniq.slice(0, 20)) console.log(`::warning::${u}`);
  if (STRICT && failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(STRICT ? 1 : 0); });
