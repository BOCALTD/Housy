/**
 * Platform settings: Paystack keys are stored encrypted and never shown in full; the person check is enforced where it is
 * turned on (and nowhere else); commission percentages are checked; only the platform administrator can change any of it.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import {
  activePaymentProvider, configForAdmin, forgetPlatformConfig, platformConfig, saveCaptcha, saveCloudflare, saveCommission, savePaystackKeys,
} from "../../src/lib/services/platform-config";
import { checkCaptcha } from "../../src/lib/captcha";
import { newPlatformAdmin, newCompany } from "./helpers";

after(() => prisma.$disconnect());

const SK = "sk_test_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
const PK = "pk_test_" + "z9Y8x7W6v5U4t3S2r1Q0p9O8n7M6";

test("Paystack keys are saved encrypted, shown only by their last characters, and used for online payments", async () => {
  const admin = await newPlatformAdmin();
  const saved = process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_SECRET_KEY;
  try {
    await assert.rejects(savePaystackKeys(admin.id, { secret: "not-a-key", public: "" }), /sk_live_ or sk_test_/);
    await assert.rejects(savePaystackKeys(admin.id, { secret: SK, public: "pk_live_" + "z9Y8x7W6v5U4t3S2r1Q0p9O8n7M6" }), /same mode/);
    await savePaystackKeys(admin.id, { secret: SK, public: PK });
    const row = await withPlatformAdmin(admin.id, (tx) => tx.platformSetting.findUniqueOrThrow({ where: { key: "paystack_secret" } }));
    assert.ok(!row.value.includes(SK) && row.value.startsWith("v1."), "the secret is not stored in plain text");
    const shown = await configForAdmin();
    assert.equal(shown.paystack.source, "settings");
    assert.equal(shown.paystack.mode, "test");
    assert.equal(shown.paystack.secretTail, "••••" + SK.slice(-4));
    assert.ok(!JSON.stringify(shown).includes(SK));
    assert.ok(await activePaymentProvider(), "online payments use the saved key");
    await savePaystackKeys(admin.id, { secret: "", public: "", clear: true });
    assert.equal(await activePaymentProvider(), null);
    // Someone who is not the platform administrator cannot change it.
    const co = await newCompany("settings-intruder");
    await assert.rejects(savePaystackKeys(co.userId, { secret: SK, public: PK }), /platform administrator/);
  } finally {
    if (saved !== undefined) process.env.PAYSTACK_SECRET_KEY = saved;
    forgetPlatformConfig();
  }
});

test("the person check is asked only where it is turned on, and a wrong or missing answer is refused", async () => {
  const admin = await newPlatformAdmin();
  try {
    await assert.rejects(saveCaptcha(admin.id, { provider: "turnstile", siteKey: "", secret: "", places: ["login"] }), /site key/);
    await saveCaptcha(admin.id, { provider: "turnstile", siteKey: "0x4AAAAAAA" + "BBBBBBBBBBBBBB", secret: "0x4AAAAAAA" + "SECRETSECRETSECRET", places: ["login"] });
    const form = new FormData();
    await assert.rejects(checkCaptcha(form, "login", "203.0.113.1"), /Complete the check/);
    form.set("cf-turnstile-response", "token-from-widget");
    let sent = "";
    const pass = (async (_url: string, init: RequestInit) => { sent = String(init.body); return new Response(JSON.stringify({ success: true })); }) as unknown as typeof fetch;
    const fail = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
    const down = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    await checkCaptcha(form, "login", "203.0.113.1", pass);
    assert.match(sent, /response=token-from-widget/);
    assert.match(sent, /remoteip=203.0.113.1/);
    await assert.rejects(checkCaptcha(form, "login", "203.0.113.1", fail), /did not pass/);
    await assert.rejects(checkCaptcha(form, "login", "203.0.113.1", down), /could not check/, "an unreachable provider does not let the form through");
    await checkCaptcha(new FormData(), "signup", "203.0.113.1", fail);
  } finally {
    await saveCaptcha(admin.id, { provider: "none", siteKey: "", secret: "", places: [] });
  }
  await checkCaptcha(new FormData(), "login", "203.0.113.1");
});

test("commission percentages and the Cloudflare setting", async () => {
  const admin = await newPlatformAdmin();
  await assert.rejects(saveCommission(admin.id, { RENT: "60", INSPECTION: "0", OTHER: "0" }), /more than 50%/);
  await assert.rejects(saveCommission(admin.id, { RENT: "five", INSPECTION: "0", OTHER: "0" }), /Rent: enter a percentage/);
  await saveCommission(admin.id, { RENT: "5", INSPECTION: "10", OTHER: "2.5" });
  assert.deepEqual((await platformConfig()).commissionBps, { RENT: 500, INSPECTION: 1000, OTHER: 250 });
  await saveCommission(admin.id, { RENT: "0", INSPECTION: "0", OTHER: "0" });
  await saveCloudflare(admin.id, true);
  assert.equal((await platformConfig()).trustCloudflare, true);
  await saveCloudflare(admin.id, false);
  assert.equal((await platformConfig()).trustCloudflare, false);
});
