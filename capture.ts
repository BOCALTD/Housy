/**
 * Walks the getting-started journey on a phone (Pixel 7) as a brand-new person and saves every screen for the guide video.
 * Sample-data labels are hidden for the film; the end card says the listings are examples.
 */
import { chromium, devices, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3100";
const OUT = "../out/screens"; mkdirSync(OUT, { recursive: true });
const log: string[] = [];
let n = 0;
const CLEAN = `
  (function(){
    var st=document.createElement('style'); st.textContent='.demo-strip{display:none!important} nextjs-portal{display:none!important}';
    function fix(root){ var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); var t; while((t=w.nextNode())){ if(t.nodeValue.indexOf('[DEMO]')>=0) t.nodeValue=t.nodeValue.split('[DEMO] ').join('').split('[DEMO]').join(''); } }
    document.addEventListener('DOMContentLoaded',function(){ document.head.appendChild(st); fix(document.body); new MutationObserver(function(){ fix(document.body); }).observe(document.body,{subtree:true,childList:true,characterData:true}); });
  })();`;
async function shot(p: Page, name: string, full = false) {
  await p.waitForTimeout(350);
  const file = `${String(++n).padStart(3, "0")}-${name}.jpg`;
  try { await p.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 92, fullPage: full, timeout: 20000 }); log.push(`${file}\t${p.url().replace(BASE, "")}`); }
  catch (e) { log.push(`${file}\tFAILED ${(e as Error).message.split("\n")[0]}`); }
  console.log(file, p.url());
}
async function typeIn(p: Page, sel: string, text: string, name: string, frames = 3) {
  const el = p.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ timeout: 8000 });
  const parts = frames; const step = Math.ceil(text.length / parts);
  for (let i = 0; i < text.length; i += step) { await el.pressSequentially(text.slice(i, i + step), { delay: 25 }); await shot(p, `${name}-t${i}`); }
}
async function go(p: Page, path: string) {
  await p.goto(BASE + path, { waitUntil: "load" });
  const t = Date.now();
  await p.waitForFunction(() => document.documentElement.classList.contains("boot-off"), null, { timeout: 20000 }).catch(() => log.push(`loader still on at ${path}`));
  log.push(`loader off after ${Date.now() - t} ms at ${path}`);
  await p.waitForTimeout(700);
}
const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { log.push(`STEP FAILED ${name}: ${(e as Error).message.split("\n")[0]}`); console.log("FAILED", name, e); } };

(async () => {
  const b = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
  const ctx = await b.newContext({ ...devices["Pixel 7"], locale: "en-NG", timezoneId: "Africa/Lagos" });
  await ctx.addInitScript({ content: "Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});" + CLEAN });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log.push(`PAGEERROR ${p.url().replace(BASE, "")}: ${e.message.slice(0, 400)}`));
  p.on("console", (m) => { if (m.type() === "error") log.push(`CONSOLE ${p.url().replace(BASE, "")}: ${m.text().slice(0, 400)}`); });
  const email = `tolu.${Date.now().toString(36)}@example.com`;

  await step("first visit", async () => {
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(600); await shot(p, "boot");
    await p.waitForFunction(() => document.documentElement.classList.contains("boot-off"), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(900); await shot(p, "intro-1");
    for (let i = 2; i <= 4; i++) { const nx = p.getByRole("button", { name: /next/i }).first(); if (!(await nx.isVisible().catch(() => false))) break; await nx.click(); await p.waitForTimeout(800); await shot(p, `intro-${i}`); }
    await p.getByRole("button", { name: /skip|get started|start|done/i }).first().click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(800); await shot(p, "home"); await shot(p, "home-full", true);
  });
  await step("join", async () => {
    await go(p, "/join?as=personal"); await shot(p, "join-empty"); await shot(p, "join-full", true);
    await typeIn(p, "#name", "Tolu Adeyemi", "join-name", 2);
    await typeIn(p, "#email", email, "join-email", 2);
    await typeIn(p, 'input[name="phone"]', "0803 456 7890", "join-phone", 2);
    await typeIn(p, 'input[name="password"]', "MyNewHome2026!", "join-pass", 2);
    await typeIn(p, 'input[name="passwordConfirm"]', "MyNewHome202", "join-confirm-partial", 1);
    await p.locator('input[name="passwordConfirm"]').first().pressSequentially("6!", { delay: 30 }); await shot(p, "join-match");
    const agree = p.locator('input[name="agree"]').first(); await agree.scrollIntoViewIfNeeded(); await agree.check(); await shot(p, "join-agree");
    await p.locator("button.auth-submit").first().click(); await p.waitForLoadState("load"); await p.waitForTimeout(1500); await shot(p, "joined"); await shot(p, "joined-full", true);
  });
  await step("my search", async () => {
    await go(p, "/me/settings#my-search"); await p.waitForTimeout(500);
    await p.locator("#my-search").scrollIntoViewIfNeeded().catch(() => {}); await shot(p, "mysearch-empty");
    await typeIn(p, '#my-search input[name="city"]', "Lagos", "mysearch-city", 1);
    await p.locator('#my-search select[name="purpose"]').selectOption("RENT"); await shot(p, "mysearch-purpose");
    await typeIn(p, '#my-search input[name="maxPrice"]', "15000000", "mysearch-budget", 2);
    await typeIn(p, '#my-search input[name="minBeds"]', "2", "mysearch-beds", 1);
    await p.locator('#my-search button[type="submit"]').first().click(); await p.waitForLoadState("load"); await p.waitForTimeout(1200);
    await p.locator("#my-search").scrollIntoViewIfNeeded().catch(() => {}); await shot(p, "mysearch-saved");
  });
  await step("home picks", async () => {
    await go(p, "/"); await p.waitForTimeout(1200); await shot(p, "home-signed-in"); await shot(p, "home-signed-in-full", true);
    const h = p.getByText(/Homes that fit your search/i).first(); if (await h.count()) { await h.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await shot(p, "home-picks"); }
  });
  let ref = "";
  await step("search", async () => {
    await go(p, "/browse"); await p.waitForTimeout(800); await shot(p, "browse-top");
    const use = p.locator(".use-my-search").first(); if (await use.count()) { await use.scrollIntoViewIfNeeded(); await shot(p, "browse-use-my-search"); await use.click(); await p.waitForLoadState("load"); await p.waitForTimeout(800); }
    await shot(p, "browse-mine"); await shot(p, "browse-mine-full", true);
    await p.locator(".sort-links").first().scrollIntoViewIfNeeded().catch(() => {}); await shot(p, "browse-sort");
    const card = p.locator(".grid a[href^='/properties/']").first(); await card.scrollIntoViewIfNeeded(); await shot(p, "browse-card");
    ref = ((await card.getAttribute("href")) ?? "").split("/")[2]?.split("?")[0] ?? "";
  });
  await step("property", async () => {
    await go(p, "/properties/" + ref); await p.waitForTimeout(1200); await shot(p, "property-top"); await shot(p, "property-full", true);
    for (const t of [/verified/i, /reviews?/i]) { const el = p.getByText(t).first(); if (await el.count()) { await el.scrollIntoViewIfNeeded().catch(() => {}); await shot(p, "property-" + t.source.replace(/\W/g, "")); } }
  });
  await step("inspection", async () => {
    const s = p.getByText("Request an inspection").first(); await s.scrollIntoViewIfNeeded(); await s.click(); await p.waitForTimeout(500); await shot(p, "inspect-open");
    const when = new Date(Date.now() + 3 * 864e5); when.setHours(11, 0, 0, 0);
    const v = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T11:00`;
    await p.locator('input[name="preferredAt"]').first().fill(v);
    await p.locator('input[name="phone"]').last().fill("0803 456 7890").catch(() => {});
    await p.locator('textarea[name="message"]').first().fill("I can come on Saturday morning. Is parking available?").catch(() => {});
    await p.locator('input[name="preferredAt"]').first().scrollIntoViewIfNeeded(); await shot(p, "inspect-filled");
    await p.getByRole("button", { name: "Request inspection" }).first().click(); await p.waitForLoadState("load"); await p.waitForTimeout(1500); await shot(p, "inspect-sent"); await shot(p, "inspect-sent-full", true);
  });
  await step("my inspections", async () => {
    await go(p, "/me/inspections"); await p.waitForTimeout(800); await shot(p, "inspections"); 
    const one = p.locator("a[href^='/me/inspections/']").first();
    if (await one.count()) { await one.click(); await p.waitForLoadState("load"); await p.waitForTimeout(1000); await shot(p, "inspection-detail"); await shot(p, "inspection-detail-full", true);
      const safe = p.getByText(/safety|share.*trip|trusted contact/i).first(); if (await safe.count()) { await safe.scrollIntoViewIfNeeded(); await shot(p, "inspection-safety"); } }
  });
  await step("enquiry and messages", async () => {
    await go(p, "/properties/" + ref);
    const m = p.locator("#enqMessage"); if (await m.count()) { await m.scrollIntoViewIfNeeded(); await shot(p, "enquiry");
      await p.getByRole("button", { name: "Send enquiry" }).first().click(); await p.waitForLoadState("load"); await p.waitForTimeout(1200); await shot(p, "enquiry-sent"); }
    await go(p, "/messages"); await p.waitForTimeout(1000); await shot(p, "messages");
    const c = p.locator("a[href^='/messages/']").first(); if (await c.count()) { await c.click(); await p.waitForLoadState("load"); await p.waitForTimeout(1200); await shot(p, "chat");
      const box = p.locator("textarea, input[name='body']").last(); if (await box.count()) { await box.click(); await box.pressSequentially("Hello! Is the flat still available for Saturday?", { delay: 15 }); await shot(p, "chat-typed"); await p.keyboard.press("Enter"); await p.waitForTimeout(1500); await shot(p, "chat-sent"); } }
  });
  await step("reels", async () => {
    await go(p, "/reels"); await p.waitForTimeout(2500); await shot(p, "reels");
    const f = p.locator(".rf-filter summary").first(); if (await f.count()) { await f.click(); await p.waitForTimeout(500); await shot(p, "reels-filter"); await p.keyboard.press("Escape"); }
    for (let i = 1; i <= 2; i++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(1600); await shot(p, `reels-next-${i}`); }
  });
  for (const [path, name] of [["/map", "map"], ["/market", "market"], ["/flatmates", "flatmates"], ["/blog", "blog"], ["/directory?kind=agents", "agents"], ["/directory?kind=companies", "companies"], ["/me", "me"], ["/me/saved", "saved"], ["/safety", "safety"]] as const) {
    await step(name, async () => { await go(p, path); await p.waitForTimeout(name === "map" ? 3500 : 1000); await shot(p, name); await shot(p, name + "-full", true); });
  }
  await step("market area", async () => { await go(p, "/market"); const a = p.locator("a[href^='/market/']").first(); if (await a.count()) { await a.click(); await p.waitForLoadState("load"); await p.waitForTimeout(1000); await shot(p, "market-area"); await shot(p, "market-area-full", true); } });
  await step("agent profile", async () => { await go(p, "/directory?kind=agents"); const a = p.locator(".dir-name a").first(); if (await a.count()) { await a.click(); await p.waitForLoadState("load"); await p.waitForTimeout(1000); await shot(p, "agent-profile"); await shot(p, "agent-profile-full", true); } });
  await step("hydration diff", async () => {
    for (const path of ["/", "/browse", "/reels", "/directory?kind=agents", "/directory?kind=companies", "/me/settings"]) {
      const html = await (await p.request.get(BASE + path)).text();
      await go(p, path);
      const diff = await p.evaluate((html) => {
        const texts = (root: Node) => { const out: string[] = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { const el = t.parentElement; if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue; const v = (t.nodeValue || "").trim(); if (v) out.push(v); } return out; };
        const server = texts(new DOMParser().parseFromString(html, "text/html").body);
        const client = texts(document.body);
        const sc = new Map<string, number>(); server.forEach((x) => sc.set(x, (sc.get(x) || 0) + 1));
        const cc = new Map<string, number>(); client.forEach((x) => cc.set(x, (cc.get(x) || 0) + 1));
        const onlyS = [...sc].filter(([k, n]) => (cc.get(k) || 0) < n).map(([k]) => k).slice(0, 25);
        const onlyC = [...cc].filter(([k, n]) => (sc.get(k) || 0) < n).map(([k]) => k).slice(0, 25);
        return { onlyS, onlyC };
      }, html);
      log.push(`DIFF ${path}\n  server only: ${JSON.stringify(diff.onlyS)}\n  client only: ${JSON.stringify(diff.onlyC)}`);
    }
  });
  writeFileSync("../out/log.txt", log.join("\n") + "\n");
  await b.close();
})();
