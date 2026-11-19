/**
 * The live chat button against the real chat providers' scripts (Tawk.to, Crisp, Tidio, Intercom), in a real browser, on the running
 * app. For each provider it sets the chat in the platform settings, opens the home page, accepts optional cookies, presses Housy's
 * chat button, and checks that:
 *   - nothing loads before cookies are accepted;
 *   - the provider's script is fetched from the provider's own servers and is not blocked by the site's security policy;
 *   - the provider's widget starts and opens from Housy's button (needs a real widget ID: the owner can add them as GitHub secrets
 *     LIVE_CHAT_TAWK_ID, LIVE_CHAT_CRISP_ID, LIVE_CHAT_TIDIO_ID, LIVE_CHAT_INTERCOM_ID; IDs are public, they appear in every web page
 *     that shows the chat, but are kept as secrets so a test run never uses the owner's chat by accident).
 * Without an ID, a well-formed sample ID is used: the script and security policy are still checked; the widget may refuse to start.
 * Afterwards the chat setting is put back as it was. Writes device-report/livechat/report.md.
 * Usage: BASE_URL=http://localhost:3100 tsx scripts/live-chat-check.ts   (LIVE_CHAT_STRICT=true fails the run on any failure)
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma, withPlatformAdmin } from "../src/lib/db";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "device-report/livechat";
mkdirSync(OUT, { recursive: true });

type Provider = "tawk" | "crisp" | "tidio" | "intercom";
const PROVIDERS: { p: Provider; domain: string; host: RegExp; sample: string; secret: string; ready: string; opened: string }[] = [
  { p: "tawk", domain: "tawk.to", host: /(^|\.)tawk\.to$/, sample: "5f1a2b3c4d5e6f7a8b9c0d1e/1h2ij3kl4", secret: "LIVE_CHAT_TAWK_ID", ready: "!!(window.Tawk_API && typeof window.Tawk_API.maximize === 'function')", opened: "!!document.querySelector('iframe[title*=\"chat\" i], iframe[src*=\"tawk\"]')" },
  { p: "crisp", domain: "crisp.chat", host: /(^|\.)crisp\.chat$/, sample: "1a2b3c4d-1234-5678-9abc-1234567890ab", secret: "LIVE_CHAT_CRISP_ID", ready: "!!(window.$crisp && typeof window.$crisp.is === 'function')", opened: "!!(window.$crisp && window.$crisp.is && window.$crisp.is('chat:opened'))" },
  { p: "tidio", domain: "tidio.co", host: /(^|\.)tidio\.co$/, sample: "abcdefghijklmnopqrstuvwxyz123456", secret: "LIVE_CHAT_TIDIO_ID", ready: "!!(window.tidioChatApi && typeof window.tidioChatApi.open === 'function')", opened: "!!document.querySelector('#tidio-chat iframe, iframe#tidio-chat-iframe')" },
  { p: "intercom", domain: "intercom", host: /(^|\.)intercom(cdn)?\.(io|com)$/, sample: "abc12def", secret: "LIVE_CHAT_INTERCOM_ID", ready: "!!(window.Intercom && typeof window.Intercom === 'function' && window.Intercom.booted !== undefined || !!document.querySelector('#intercom-frame'))", opened: "!!document.querySelector('iframe[name=\"intercom-messenger-frame\"], .intercom-messenger-frame')" },
];

const KEYS = ["live_chat_provider", "live_chat_id", "live_chat_places"];
async function setChat(provider: string, id: string) {
  const admin = await prisma.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
  await withPlatformAdmin("system", async (tx) => {
    for (const [key, value] of [["live_chat_provider", provider], ["live_chat_id", id], ["live_chat_places", "public,me,app"]]) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: admin?.id ?? null }, update: { value, updatedById: admin?.id ?? null } });
    }
  });
}

type Row = { provider: string; id: string; step: string; ok: boolean | null; note: string };
const rows: Row[] = [];

async function main() {
  const before = await prisma.platformSetting.findMany({ where: { key: { in: KEYS } } });
  const browser = await chromium.launch();
  try {
    for (const prov of PROVIDERS) {
      const realId = (process.env[prov.secret] ?? "").trim();
      const id = realId || prov.sample;
      const label = realId ? "your widget" : "sample ID";
      const add = (step: string, ok: boolean | null, note: string) => { rows.push({ provider: prov.p, id: label, step, ok, note }); console.log(`${ok === null ? "--" : ok ? "ok" : "FAIL"}  ${prov.p} (${label}): ${step}: ${note}`); };
      await setChat(prov.p, id);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-NG" });
      const page = await ctx.newPage();
      const providerRequests: { url: string; status: number }[] = [];
      const blocked: string[] = [];
      const failedReq: string[] = [];
      page.on("requestfailed", (r) => { try { if (prov.host.test(new URL(r.url()).hostname)) failedReq.push(`${new URL(r.url()).hostname}: ${r.failure()?.errorText ?? "failed"}`); } catch { /* ignore */ } });
      page.on("response", (r) => { try { if (prov.host.test(new URL(r.url()).hostname)) providerRequests.push({ url: r.url(), status: r.status() }); } catch { /* not a web address */ } });
      page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to (load|connect|frame|execute)/i.test(t) && t.includes(prov.domain)) blocked.push(t.slice(0, 200)); });
      // The settings are cached by the app for up to 30 seconds: wait until the page carries this provider's chat button.
      let shown = false;
      for (let i = 0; i < 25 && !shown; i++) {
        await page.goto(`${BASE}/`, { waitUntil: "load" });
        shown = (await page.locator(".chat-fab").count()) > 0 && (await page.content()).includes(id);
        if (!shown) await page.waitForTimeout(2000);
      }
      if (!shown) { add("chat button shown", false, "the chat button did not appear after the setting changed"); await ctx.close(); continue; }
      await page.waitForTimeout(1500);
      add("nothing loads before cookies are accepted", providerRequests.length === 0, providerRequests.length ? `${providerRequests.length} requests to the provider before consent` : "no request to the provider");
      // Accept optional cookies through the site's own notice.
      // The notice appears once the page has started; give it time, and if it never shows, set the choice and reload.
      const accept = page.getByRole("button", { name: "Accept all" }).first();
      const noticed = await accept.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
      if (noticed) await accept.click();
      else { await ctx.addCookies([{ name: "cookie_choice", value: "all", domain: new URL(BASE).hostname, path: "/" }]); await page.reload({ waitUntil: "load" }); }
      await page.locator(".chat-fab").waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.locator(".chat-fab").click().catch(() => undefined);
      const t0 = Date.now();
      while (Date.now() - t0 < 20000 && !providerRequests.some((r) => r.status === 200)) await page.waitForTimeout(500);
      const script = providerRequests.find((r) => r.status === 200);
      // With a made-up ID some providers answer with an error page instead of a script, which the browser blocks (ORB). That
      // still shows Housy started the chat and reached the provider; only a real widget ID can show the script itself.
      const refusedSample = !script && !realId && failedReq.some((f) => /ERR_BLOCKED_BY_ORB/.test(f));
      if (refusedSample) add("provider's script loads from its servers", null, `the chat started and reached ${failedReq[0].split(":")[0]}, which refused the sample ID; needs your real widget ID as a GitHub secret`);
      else add("provider's script loads from its servers", !!script, script ? `${new URL(script.url).hostname} answered 200` : providerRequests.length ? `answers: ${providerRequests.map((r) => r.status).join(", ")}` : failedReq.length ? `request failed: ${failedReq[0]}` : `no request was made (cookie notice ${noticed ? "accepted" : "not shown, choice set directly"})`);
      if (!script) await page.screenshot({ path: `${OUT}/${prov.p}-no-script.jpg`, type: "jpeg", quality: 60 }).catch(() => undefined);
      await page.waitForTimeout(6000);
      add("security policy allows it", blocked.length === 0, blocked.length ? blocked[0] : "no blocked requests");
      const ready = await page.evaluate(prov.ready).catch(() => false) as boolean;
      if (realId) {
        await page.locator(".chat-fab").click().catch(() => undefined);
        await page.waitForTimeout(4000);
        const opened = await page.evaluate(prov.opened).catch(() => false) as boolean;
        add("widget starts", ready, ready ? "the provider's chat started" : "the provider's chat did not start");
        add("Housy's button opens it", opened, opened ? "the chat window opened" : "the chat window did not open");
        await page.screenshot({ path: `${OUT}/${prov.p}.jpg`, type: "jpeg", quality: 70 }).catch(() => undefined);
      } else {
        add("widget starts", ready ? true : null, ready ? "the provider's chat started even with the sample ID" : "not checked: needs your real widget ID as a GitHub secret");
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    // Put the chat setting back exactly as it was.
    await withPlatformAdmin("system", async (tx) => {
      await tx.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
      for (const r of before) await tx.platformSetting.create({ data: r });
    });
    await prisma.$disconnect();
  }
  const fails = rows.filter((r) => r.ok === false).length;
  writeFileSync(`${OUT}/report.md`, [
    "# Live chat against the real providers", "",
    `Run ${new Date().toISOString()} on ${BASE}. ${fails ? `**${fails} failed.**` : "Nothing failed."}`, "",
    "| Provider | Widget ID | Step | Result | Detail |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.provider} | ${r.id} | ${r.step} | ${r.ok === null ? "not checked" : r.ok ? "ok" : "**failed**"} | ${r.note.replace(/\|/g, "/")} |`),
  ].join("\n") + "\n");
  if (fails && process.env.LIVE_CHAT_STRICT === "true") process.exit(1);
}

void main();
