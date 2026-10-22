/**
 * Opens the running app on emulated desktop, iPhone, Android and tablet profiles and checks what a
 * person on a small screen would trip over: sideways scrolling, text fields small enough to make
 * iOS zoom the page, touch targets that are too small, unreadably small text, missing labels and
 * script errors. Screenshots of the key pages are saved for review.
 *
 * Usage: SESSION_OUT="<output of smoke-session.ts>" tsx scripts/device-check.ts
 * Set DEVICE_STRICT=true to exit with an error when any check fails.
 *
 * Honest limit: this is the WebKit and Chromium engines with phone-sized screens, touch input and
 * phone user agents. It is close to, but not the same as, real iOS Safari or real Android hardware.
 */
import { chromium, webkit, devices, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const STRICT = process.env.DEVICE_STRICT === "true";
const OUT = "device-report";

const PROFILES: { name: string; device: string; engine: "chromium" | "webkit"; shots: boolean }[] = [
  { name: "Desktop Chrome", device: "Desktop Chrome", engine: "chromium", shots: true },
  { name: "Desktop Safari", device: "Desktop Safari", engine: "webkit", shots: false },
  { name: "iPhone SE (small iPhone)", device: "iPhone SE", engine: "webkit", shots: true },
  { name: "iPhone 14 Pro Max (large iPhone)", device: "iPhone 14 Pro Max", engine: "webkit", shots: false },
  { name: "Pixel 7 (Android)", device: "Pixel 7", engine: "chromium", shots: true },
  { name: "Galaxy S9+ (small Android)", device: "Galaxy S9+", engine: "chromium", shots: false },
  { name: "iPad (tablet)", device: "iPad (gen 7)", engine: "webkit", shots: false },
];

// Screenshots are only for the report. A slow capture (font loading in CI) is not a compatibility finding.
async function shot(page: import("@playwright/test").Page, opts: Parameters<import("@playwright/test").Page["screenshot"]>[0]) {
  try { await page.screenshot({ ...opts, animations: "disabled", timeout: 15000 }); } catch { /* best effort */ }
}

// Pages that get a screenshot on the profiles that take them.
const SHOT_PATTERNS = ["/", "/login", "/faq", "/how-it-works", "/reviews", "/safety", "/about", "/app/verification", "/me/verification", "/admin/kyc", "/app", "/app/assets", "/app/maintenance", "/app/inventory", "/app/inspections", "/app/compliance", "/app/assets/:id", "/app/leases/:id", "/app/maintenance/:id", "/app/handover-inventory/:id"];

interface Issue { kind: string; page: string; profile: string; detail: string; items: string[] }
const issues: Issue[] = [];

const pattern = (p: string) => p.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, "/:id").replace(/\/(PROP|prop)-[A-Z0-9]+/g, "/:id");

async function inspect(page: Page, touch: boolean) {
  return page.evaluate((isTouch) => {
    const vw = window.innerWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const scrollsSideways = (el: Element | null) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if ((o === "auto" || o === "scroll") && e.scrollWidth > e.clientWidth) return true;
        if (o === "auto" || o === "scroll" || o === "hidden") return true;
      }
      return false;
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    const out: Record<string, unknown> = {};
    const doc = document.documentElement;
    out.overflow = doc.scrollWidth - doc.clientWidth;
    const wide: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflowX === "visible" && el !== doc)) {
          const box = scrollsSideways(el.parentElement);
          if (box) continue;
          wide.push(`${label(el)} right=${Math.round(r.right)} w=${Math.round(r.width)} parent=${label(el.parentElement as Element).slice(0, 40)} ${box ? "(inside a scroll box)" : "(NOT in a scroll box)"}`);
        }
        if (wide.length >= 12) break;
      }
    }
    out.wide = wide;
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
    out.viewport = viewport;
    const smallFields: string[] = [];
    const unlabelled: string[] = [];
    for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
      const input = el as HTMLInputElement;
      if (["hidden", "checkbox", "radio", "file", "submit"].includes(input.type) || !visible(el)) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 16) smallFields.push(label(el));
      const hasLabel = (input.labels && input.labels.length > 0) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label");
      if (!hasLabel) unlabelled.push(`${label(el)} name=${input.name}`);
    }
    out.smallFields = smallFields;
    out.unlabelled = unlabelled;
    const tiny: string[] = [];
    if (isTouch) {
      for (const el of Array.from(document.querySelectorAll("a, button, input, select, textarea, summary, [role=button]"))) {
        const t = (el as HTMLInputElement).type;
        if (t === "hidden" || !visible(el)) continue;
        const s = getComputedStyle(el);
        if (el.tagName === "A" && s.display === "inline") continue; // links inside a sentence
        const holder = (t === "checkbox" || t === "radio") ? (el.closest("label") ?? el) : el;
        const r = holder.getBoundingClientRect();
        if (r.height < 44 || (r.width < 44 && el.tagName !== "A" && (el.textContent ?? "").trim().length < 4)) tiny.push(`${label(el)} type=${t} name=${(el as HTMLInputElement).name ?? ""} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    out.tiny = tiny;
    let small = 0;
    const smallItems: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let lowest = 99;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? "").trim() || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) { small += 1; lowest = Math.min(lowest, fs); if (smallItems.length < 6) smallItems.push(`${label(el)} ${fs}px`); }
    }
    out.smallText = small;
    out.smallItems = smallItems;
    out.lowest = lowest;
    out.noAlt = Array.from(document.querySelectorAll("img:not([alt])")).filter(visible).length;
    // Accessibility: language, one main heading, a main landmark, names for every control, no repeated ids, and a way past the menu.
    out.lang = document.documentElement.getAttribute("lang") ?? "";
    out.h1 = Array.from(document.querySelectorAll("h1")).filter(visible).length;
    out.hasMain = !!document.querySelector("main");
    const name = (el: Element) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.textContent ?? "").trim() || (el.querySelector("img[alt]:not([alt=''])") ? "x" : ""));
    out.unnamed = Array.from(document.querySelectorAll("a[href], button, [role=button]")).filter(visible).filter((el) => !name(el)).slice(0, 8).map(label);
    const ids = new Map<string, number>();
    for (const el of Array.from(document.querySelectorAll("[id]"))) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    out.dupIds = Array.from(ids).filter(([, n]) => n > 1).map(([id]) => id).slice(0, 8);
    out.positiveTabindex = Array.from(document.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0).length;
    const skip = document.querySelector("a.skip-link");
    out.skipLink = !!skip && skip.getAttribute("href") === "#main" && !!document.getElementById("main");
    return out as { lang: string; h1: number; hasMain: boolean; unnamed: string[]; dupIds: string[]; positiveTabindex: number; skipLink: boolean; overflow: number; wide: string[]; viewport: string; smallFields: string[]; unlabelled: string[]; tiny: string[]; smallText: number; smallItems: string[]; lowest: number; noAlt: number };
  }, touch);
}

async function main() {
  const sessionOut = process.env.SESSION_OUT ?? execFileSync("npx", ["tsx", "scripts/smoke-session.ts"], { encoding: "utf8" });
  const lines = sessionOut.trim().split("\n");
  const token = lines[0];
  const seekerToken = lines[2];
  const platformToken = lines[3];
  const tokenFor = (p: string) => (p.startsWith("/me") || p.startsWith("/directory") || p.startsWith("/messages") || p.startsWith("/referrals") || p.startsWith("/rewards") || p.startsWith("/vacancies") || p.startsWith("/feedback") || p.startsWith("/reviews") ? seekerToken : p.startsWith("/admin") ? platformToken : token);
  const all = lines.slice(4).filter((p) => !p.endsWith(".csv"));
  const seen = new Set<string>();
  const signedIn: string[] = [];
  for (const p of all) {
    const pat = pattern(p);
    if (seen.has(pat)) continue;
    seen.add(pat);
    signedIn.push(p);
  }
  const landing = await (await fetch(`${BASE}/`)).text();
  const prop = landing.match(/properties\/PROP-[A-Z0-9]+/)?.[0];
  const publicPages = ["/", "/login", "/forgot", "/support", "/signup", "/join", "/faq", "/how-it-works", "/about", "/safety", "/reviews", ...(prop ? [`/${prop}`] : [])];
  const pages = [...publicPages.map((p) => ({ p, auth: false })), ...signedIn.map((p) => ({ p, auth: true }))];
  mkdirSync(`${OUT}/screens`, { recursive: true });

  const browsers: Record<string, Browser> = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const rows: string[] = [];
  for (const prof of PROFILES) {
    const d = devices[prof.device];
    const context = await browsers[prof.engine].newContext({ ...d, reducedMotion: "reduce" });
    // tsx adds a __name helper to functions it compiles; the browser page does not have it.
    await context.addInitScript("window.__name = (f) => f;");
    await context.addCookies([{ name: "sid", value: token, domain: "localhost", path: "/" }]);
    const touch = !!d.hasTouch;
    let pageCount = 0;
    let signedInAs = token;
    for (const { p, auth } of pages) {
      const wanted = auth ? tokenFor(p) : token;
      if (wanted !== signedInAs) {
        await context.clearCookies();
        await context.addCookies([{ name: "sid", value: wanted, domain: "localhost", path: "/" }]);
        signedInAs = wanted;
      }
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      const add = (kind: string, detail: string, items: string[] = []) => issues.push({ kind, page: p, profile: prof.name, detail, items });
      try {
        const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 30000 });
        if (!res || res.status() >= 400) add("http", `status ${res?.status()}`);
        if (!auth || p.startsWith("/app") || p.startsWith("/me") || p.startsWith("/directory") || p.startsWith("/messages") || p.startsWith("/referrals") || p.startsWith("/rewards") || p.startsWith("/vacancies") || p.startsWith("/feedback") || p.startsWith("/reviews") || p.startsWith("/reels") || p.startsWith("/awards") || p.startsWith("/completed") || p.startsWith("/admin")) {
          const r = await inspect(page, touch);
          if (!/width=device-width/.test(r.viewport)) add("viewport", `viewport meta is "${r.viewport}"`);
          if (r.overflow > 1) add("sideways-scroll", `page is ${r.overflow}px wider than the screen`, r.wide);
          if (touch && r.smallFields.length) add("small-input-text", `${r.smallFields.length} field(s) under 16px`, r.smallFields);
          if (touch && r.tiny.length) add("small-touch-target", `${r.tiny.length} control(s) under 44px`, r.tiny);
          if (r.smallText) add("small-text", `${r.smallText} text run(s) under 12px (smallest ${r.lowest}px)`, r.smallItems);
          if (r.unlabelled.length) add("unlabelled-field", `${r.unlabelled.length} field(s)`, r.unlabelled);
          if (r.noAlt) add("image-no-alt", `${r.noAlt} image(s) without alt text`);
          if (!r.lang) add("no-language", "the page does not say what language it is in");
          if (r.h1 !== 1) add("main-heading", `${r.h1} main headings (expected 1)`);
          if (!r.hasMain) add("no-main-landmark", "no main region");
          if (r.unnamed.length) add("unnamed-control", `${r.unnamed.length} link(s) or button(s) with no name`, r.unnamed);
          if (r.dupIds.length) add("duplicate-id", `${r.dupIds.length} repeated id(s)`, r.dupIds);
          if (r.positiveTabindex) add("tab-order-forced", `${r.positiveTabindex} control(s) force the tab order`);
          if (!r.skipLink) add("no-skip-link", "no working skip-to-content link");
          if (!touch && prof.engine === "chromium") {
            // Keyboard: Tab through the page. The first stop is the skip link, every stop is visibly marked, and focus never gets stuck.
            const stops: { tag: string; text: string; marked: boolean; first?: boolean }[] = [];
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            for (let k = 0; k < 30; k++) {
              await page.keyboard.press("Tab");
              stops.push(await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null;
                if (!el || el === document.body) return { tag: "body", text: "", marked: true };
                const s = getComputedStyle(el);
                // A date field has inner parts (month, day, year and the calendar button); the last stop reports the field itself without focus-visible. Not a real gap.
                const inner = el instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week"].includes(el.type);
                const marked = inner || (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none") || (s.boxShadow !== "none" && s.boxShadow !== "");
                const what = el instanceof HTMLInputElement ? ` type=${el.type} name=${el.name}` : "";
                return { tag: el.tagName.toLowerCase() + what, text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30), marked, first: el.classList.contains("skip-link") };
              }));
            }
            if (!stops[0]?.first) add("keyboard-first-stop", `the first Tab stop is "${stops[0]?.text}", not the skip link`);
            const unmarked = stops.filter((x) => !x.marked && x.tag !== "body");
            if (unmarked.length) add("keyboard-focus-hidden", `${unmarked.length} Tab stop(s) show no focus mark`, unmarked.slice(0, 6).map((x) => `${x.tag} "${x.text}"`));
            const distinct = new Set(stops.map((x) => `${x.tag}:${x.text}`)).size;
            if (stops.length >= 10 && distinct < 4) add("keyboard-trap", `focus visited only ${distinct} different controls in ${stops.length} presses`);
          }
          if (!touch && prof.engine === "chromium") {
            // Reduced motion: when the person asks for less movement, nothing may keep animating.
            await page.emulateMedia({ reducedMotion: "reduce" });
            const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && ((a.effect?.getComputedTiming().iterations ?? 1) === Infinity || (a.effect?.getComputedTiming().duration as number) > 50)).length);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            if (moving) add("ignores-reduced-motion", `${moving} animation(s) still run when the person asked for less motion`);
          }
        }
        for (const e of errors.slice(0, 3)) add("script-error", e.slice(0, 200));
        const wantShot = prof.shots && (SHOT_PATTERNS.includes(pattern(p)) || issues.some((i) => i.page === p && i.profile === prof.name && i.kind === "sideways-scroll"));
        if (wantShot && prof.engine === "webkit") {
          // Full-page captures of tall pages come out black in WebKit, so take screen-sized tiles instead.
          const vh = page.viewportSize()!.height;
          for (let t = 0; t < 3; t += 1) {
            await page.evaluate((y) => window.scrollTo(0, y), t * vh);
            await shot(page, { path: `${OUT}/screens/${prof.device.replace(/\W+/g, "_")}__${pattern(p).replace(/\W+/g, "_") || "home"}__${t}.png` });
          }
        } else if (wantShot) await shot(page, { path: `${OUT}/screens/${prof.device.replace(/\W+/g, "_")}__${pattern(p).replace(/\W+/g, "_") || "home"}.jpg`, type: "jpeg", quality: 55, fullPage: true });
      } catch (e) {
        add("load-failed", String(e).slice(0, 200));
      }
      await page.close();
      pageCount += 1;
    }
    rows.push(`| ${prof.name} | ${d.viewport.width}x${d.viewport.height} | ${pageCount} | ${issues.filter((i) => i.profile === prof.name).length} |`);
    await context.close();
  }
  await Promise.all(Object.values(browsers).map((b) => b.close()));

  // Group by kind, then by the element that has the problem, with the pages and profiles it appears on.
  const byKind = new Map<string, Map<string, { pages: Set<string>; profiles: Set<string> }>>();
  for (const i of issues) {
    const kinds = byKind.get(i.kind) ?? new Map();
    byKind.set(i.kind, kinds);
    const keys = i.items.length ? i.items : [i.detail];
    for (const raw of keys) {
      const key = raw.replace(/\d+(\.\d+)?x\d+(\.\d+)?/g, "WxH").replace(/right=\d+ w=\d+/, "").replace(/(\d+(\.\d+)?)px/, "Npx").slice(0, 160);
      const g = kinds.get(key) ?? { pages: new Set<string>(), profiles: new Set<string>() };
      g.pages.add(pattern(i.page)); g.profiles.add(i.profile.split(" (")[0]);
      kinds.set(key, g);
    }
  }
  const md = [
    "## Device check", "", `${pages.length} pages on ${PROFILES.length} profiles.`, "",
    "| Profile | Screen | Pages | Problems |", "|---|---|---|---|", ...rows, "",
    ...[...byKind].flatMap(([kind, m]) => [
      `### ${kind} (${m.size} distinct)`, "",
      ...[...m].sort((a, b) => b[1].pages.size - a[1].pages.size).slice(0, 40).map(([k, g]) => `- ${k} | ${g.pages.size} page(s): ${[...g.pages].slice(0, 8).join(", ")} | ${[...g.profiles].join(", ")}`), "",
    ]),
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, md);
  writeFileSync(`${OUT}/issues.json`, JSON.stringify(issues, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.slice(0, 900000));
  console.log(md.split("\n").slice(0, 60).join("\n"));
  const esc = (t: string) => t.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const chunks: string[] = [];
  let cur = "";
  for (const line of md.split("\n")) { if (cur.length + line.length > 3300) { chunks.push(cur); cur = ""; } cur += line + "\n"; }
  if (cur) chunks.push(cur);
  chunks.slice(0, 14).forEach((c, n) => console.log(`::notice title=Device report ${n + 1}::${esc(c)}`));
  const grouped = { size: issues.length };
  if (STRICT && grouped.size > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
