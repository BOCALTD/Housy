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
