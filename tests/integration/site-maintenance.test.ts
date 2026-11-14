/**
 * Upgrade and maintenance mode: scheduled by the platform administrator with a day's notice; everyone active is told in the app
 * and by email once; cancelling tells them it is off; only the administrator can do any of it.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { endMaintenance, forgetMaintenance, maintenanceNow, scheduleMaintenance, sendMaintenanceNotice } from "../../src/lib/services/maintenance-mode";
import { toLagosLocal } from "../../src/lib/dates";
import { newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const H = 3_600_000;

test("maintenance is announced once, 24 hours before, in the app and by email; cancelling it tells people it is off", async () => {
  const admin = await newPlatformAdmin();
  const person = await registerSeeker({ name: "Told Person", email: `maint-${Date.now()}@example.test`, password: "integration-test-pw" });
  const now = new Date();
  await assert.rejects(scheduleMaintenance(person.userId, { start: toLagosLocal(new Date(now.getTime() + 30 * H)), end: toLagosLocal(new Date(now.getTime() + 31 * H)), message: "", emergency: false }), /platform administrator/);
  await assert.rejects(scheduleMaintenance(admin.id, { start: toLagosLocal(new Date(now.getTime() + 2 * H)), end: toLagosLocal(new Date(now.getTime() + 3 * H)), message: "", emergency: false }), /24 hours/);
  await scheduleMaintenance(admin.id, { start: toLagosLocal(new Date(now.getTime() + 30 * H)), end: toLagosLocal(new Date(now.getTime() + 32 * H)), message: "Faster search.", emergency: false });
  forgetMaintenance();
  assert.equal((await maintenanceNow()).phase, "scheduled");

  const count = async (kind: string) => ({
    notices: await withUser(person.userId, (tx) => tx.notification.count({ where: { userId: person.userId, kind } })),
    emails: await withPlatformAdmin(admin.id, (tx) => tx.emailOutbox.count({ where: { userId: person.userId, kind } })),
  });
  assert.equal((await sendMaintenanceNotice(now)).sent, 0, "too early to tell anyone");
  const atNotice = new Date(now.getTime() + 7 * H);
  const r = await sendMaintenanceNotice(atNotice);
  assert.ok(r.sent >= 2, "everyone active is told");
  assert.deepEqual(await count("system.maintenance"), { notices: 1, emails: 1 });
  forgetMaintenance();
  await sendMaintenanceNotice(new Date(atNotice.getTime() + H));
  assert.deepEqual(await count("system.maintenance"), { notices: 1, emails: 1 }, "only once");
  const email = await withPlatformAdmin(admin.id, (tx) => tx.emailOutbox.findFirstOrThrow({ where: { userId: person.userId, kind: "system.maintenance" } }));
  assert.equal(email.category, "ESSENTIAL", "it is sent whatever their email settings");
  assert.match(JSON.stringify(email.vars), /Faster search/);

  assert.equal(await endMaintenance(admin.id), "cancelled");
  forgetMaintenance();
  assert.equal((await maintenanceNow()).phase, "none");
  const cancelled = await withUser(person.userId, (tx) => tx.notification.findFirst({ where: { userId: person.userId, kind: "system.maintenance", title: "Planned maintenance cancelled" } }));
  assert.ok(cancelled, "they are told it is off");
  await assert.rejects(endMaintenance(admin.id), /No maintenance/);
});

test("an emergency window may start at once and is announced straight away", async () => {
  const admin = await newPlatformAdmin();
  const now = new Date();
  await scheduleMaintenance(admin.id, { start: toLagosLocal(new Date(now.getTime() + 60_000)), end: toLagosLocal(new Date(now.getTime() + 2 * H)), message: "", emergency: true });
  forgetMaintenance();
  const m = await maintenanceNow();
  assert.ok(m.window?.notifiedAt, "announced at once");
  assert.equal(m.phase === "active" || m.phase === "notice", true);
  await endMaintenance(admin.id);
  forgetMaintenance();
});
