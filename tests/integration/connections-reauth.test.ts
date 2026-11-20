/**
 * Connections set in Admin instead of on the server, and "confirm it's you" for sensitive areas.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { envNow, loadRuntimeEnv, makePushKeys, managedForAdmin, saveManaged } from "../../src/lib/runtime-env";
import { configuredDriver } from "../../src/lib/email-drivers";
import { vapidFromEnv } from "../../src/lib/webpush";
import { confirmIdentity } from "../../src/lib/services/reauth";
import { confirmedRecently, isSensitiveAction, isSensitivePath } from "../../src/lib/reauth-rules";
import { hashPassword } from "../../src/lib/auth-hash";
import { hashToken, newToken } from "../../src/lib/tokens";
import { newCompany, newPlatformAdmin } from "./helpers";

// Saved connections are platform-wide: leave none behind for other tests.
after(async () => { await prisma.platformSetting.deleteMany({ where: { key: { startsWith: "cfg:" } } }); await prisma.$disconnect(); });

test("connections: saved encrypted, checked, used at once; the server's own value wins", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("conn");
  await assert.rejects(saveManaged(co.userId, "contact", { SUPPORT_EMAIL: "help@example.test" }), /platform administrator/);
  await assert.rejects(saveManaged(admin.id, "contact", { SUPPORT_EMAIL: "not an email" }), /Support email: Enter an email address/);
  await assert.rejects(saveManaged(admin.id, "email", { EMAIL_PROVIDER: "smtp", EMAIL_FROM: "Housy <hello@example.test>", SMTP_HOST: "smtp.example.test" }), /SMTP server, user name and password/);

  await saveManaged(admin.id, "email", { EMAIL_PROVIDER: "smtp", EMAIL_FROM: "Housy <hello@example.test>", SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "hello@example.test", SMTP_PASSWORD: "app-password-123456" });
  const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key: "cfg:SMTP_PASSWORD" } });
  assert.ok(!row.value.includes("app-password"), "the password is stored encrypted");
  if (!process.env.RESEND_API_KEY && !process.env.EMAIL_FROM) {
    assert.equal(configuredDriver(envNow())?.name, "smtp", "used straight away, without a restart");
    const shown = (await managedForAdmin()).email.find((f) => f.name === "SMTP_PASSWORD")!;
    assert.equal(shown.value, "");
    assert.equal(shown.tail, "…3456");
    // Saving again without the password keeps it; ticking "remove" removes it (and the group must then be complete again).
    await saveManaged(admin.id, "email", { EMAIL_PROVIDER: "smtp", EMAIL_FROM: "Housy <hello@example.test>", SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "hello@example.test", SMTP_PASSWORD: "" });
    assert.equal(envNow().SMTP_PASSWORD, "app-password-123456");
    await saveManaged(admin.id, "email", { EMAIL_PROVIDER: "", EMAIL_FROM: "", SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASSWORD: "" }, ["SMTP_PASSWORD"]);
    assert.equal(configuredDriver(envNow()), null);
  }

  // A value in the server's settings file wins and cannot be changed here.
  process.env.SUPPORT_PHONE = "+234 800 000 0000";
  await saveManaged(admin.id, "contact", { SUPPORT_PHONE: "+234 811 111 1111", SUPPORT_EMAIL: "help@example.test" });
  await loadRuntimeEnv(true);
  assert.equal(envNow().SUPPORT_PHONE, "+234 800 000 0000");
  assert.equal(envNow().SUPPORT_EMAIL, "help@example.test");
  assert.equal((await managedForAdmin()).contact.find((f) => f.name === "SUPPORT_PHONE")!.server, true);
  delete process.env.SUPPORT_PHONE;

  // Push keys are made here: a valid P-256 pair the push sender accepts.
  if (!process.env.VAPID_PUBLIC_KEY) {
    const pub = await makePushKeys(admin.id);
    assert.equal(vapidFromEnv(envNow())?.publicKey, pub);
  }
});

test("confirm it's you: password (and the code), a window that runs out, and sign-out after five wrong tries", async () => {
  assert.equal(isSensitivePath("/admin/connections"), true);
  assert.equal(isSensitivePath("/admin/settings/anything"), true);
  assert.equal(isSensitivePath("/admin/blog"), false);
  assert.equal(isSensitivePath("/admin/settingsx"), false);
  assert.equal(isSensitiveAction("payout.approve"), true);
  assert.equal(isSensitiveAction("asset.view"), false);
  assert.equal(confirmedRecently({ reauthAt: new Date(Date.now() - 14 * 60_000) }), true);
  assert.equal(confirmedRecently({ reauthAt: new Date(Date.now() - 16 * 60_000) }), false);
  assert.equal(confirmedRecently({ reauthAt: null }), false);

  const admin = await newPlatformAdmin();
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword("right-password-123") } });
  const make = () => prisma.session.create({ data: { userId: admin.id, tokenHash: hashToken(newToken()), expiresAt: new Date(Date.now() + 3600_000) } });
  const s = await make();
  const wrong = await confirmIdentity(s.id, "nope", "");
  assert.equal(wrong.ok, false);
  assert.match((wrong as { error: string }).error, /4 tries left/);
  assert.equal((await confirmIdentity(s.id, "right-password-123", "")).ok, true);
  const after1 = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
  assert.ok(after1.reauthAt && confirmedRecently(after1));
  assert.equal(after1.reauthFails, 0, "a right answer clears the wrong tries");

  const t = await make();
  for (let i = 0; i < 4; i++) await confirmIdentity(t.id, "nope", "");
  const last = await confirmIdentity(t.id, "nope", "");
  assert.equal(last.ok, false);
  assert.equal((last as { signedOut?: boolean }).signedOut, true);
  assert.equal(await prisma.session.findUnique({ where: { id: t.id } }), null, "the session is ended");
});
